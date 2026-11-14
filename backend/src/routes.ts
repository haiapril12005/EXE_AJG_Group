import { Router, type NextFunction, type Response } from "express";
import rateLimit from "express-rate-limit";
import multer from "multer";
import { z } from "zod";
import { deriveUserCode, fetchAdminOverview, isMissingAdminColumn, listAdminUsers, MIGRATION_007 } from "./admin";
import { buildChatInput, chatRequestSchema } from "./chat";
import { analyzeCVvsJD, chatReply, evaluateInterviewAnswer, generateCvQualityFeedback, generateMockQuestions, rewriteSection, rewriteSectionSchema, structureCV } from "./aiService";
import { cvDataSchema, cvDataToText, imageDataUrlSchema, emptyCvData, extractContacts, extractLinks, maskText, stripNul, type CvData } from "./cvData";
import { inspectCvQuality, scoreQualityIssues } from "./cvQuality";
import { requireAuth, type AuthenticatedRequest } from "./auth";
import { config } from "./config";
import { HttpError } from "./errors";
import { categoriesOfFilter, JOB_CATEGORY_FILTERS, JOB_CATEGORY_GROUPS } from "./jobs/categories";
import { createPayOSPayment, verifyPayOSWebhook } from "./payments";
import { authClient, supabase } from "./supabase";
import { parseBody } from "./validation";
import { synthesizeQuestion, transcribeAudio } from "./speech";
import { normalizeEvidence } from "./scoring";
import { withAiContext } from "./aiUsage";
import { fetchAdminActivity, fetchAdminJobStats, fetchAdminUserDetail, fetchAiUsageReport, listAdminTransactions } from "./adminAnalytics";
import { followUpQuestionOf, interviewQuestionsSchema, MAX_QUESTIONS, overallScore, withPreviousAttempt } from "./interview";

const router = Router();
// Keeps the request in async context so each AI call is recorded with its user and feature.
router.use(withAiContext);

const LIST_PAGE_SIZE = 20;
const listPageSchema = z.object({ page: z.coerce.number().int().min(1).max(1000).default(1) });

/** History lists page in 20s; `range` is inclusive. */
function listPage(query: unknown) {
  const parsed = listPageSchema.safeParse(query);
  if (!parsed.success) throw new HttpError(400, "Invalid page");
  const from = (parsed.data.page - 1) * LIST_PAGE_SIZE;
  return { page: parsed.data.page, from, to: from + LIST_PAGE_SIZE - 1 };
}

/** PGRST103 means the page is past the last row, which is simply an empty page. */
function pageError(error: { code?: string } | null) {
  return error && error.code !== "PGRST103" ? error : null;
}

/** The embedded row of a many-to-one join; PostgREST may return it as an object or a one-item list. */
function embedded<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}
const paymentsEnabled = Boolean(config.PAYOS_CLIENT_ID && config.PAYOS_API_KEY && config.PAYOS_CHECKSUM_KEY);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    const looksLikePdf = file.mimetype === "application/pdf" ||
      (file.mimetype === "application/octet-stream" && file.originalname.toLowerCase().endsWith(".pdf"));
    if (!looksLikePdf) {
      callback(new Error("Only PDF files are allowed"));
      return;
    }
    callback(null, true);
  }
});

const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!/^audio\/(webm|ogg|wav|mpeg|mp3|mp4|x-m4a|aac)(?:;.*)?$/iu.test(file.mimetype)) {
      callback(new Error("Only audio recordings are allowed"));
      return;
    }
    callback(null, true);
  }
});

function userId(req: AuthenticatedRequest): string {
  if (!req.userId) throw new HttpError(401, "Authentication required");
  return req.userId;
}

function sendError(res: Response, error: unknown) {
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  console.error("Request failed", error);
  res.status(500).json({ error: "The request could not be completed" });
}

const authBodySchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(8).max(128),
  full_name: z.string().trim().min(1).max(120).optional()
});

router.post("/auth/register", async (req, res) => {
  try {
    const body = parseBody(authBodySchema, req.body);
    if (!body.full_name) throw new HttpError(400, "Full name is required");
    const { data, error } = await authClient.auth.signUp({
      email: body.email,
      password: body.password,
      options: { data: { full_name: body.full_name } }
    });
    if (error) throw new HttpError(400, error.message);
    res.status(201).json({
      user: data.user ? { id: data.user.id, email: data.user.email } : null,
      session: data.session,
      message: data.session ? undefined : "Check your email to confirm your account."
    });
  } catch (error) {
    sendError(res, error);
  }
});

router.post("/auth/login", async (req, res) => {
  try {
    const body = parseBody(authBodySchema.omit({ full_name: true }), req.body);
    const { data, error } = await authClient.auth.signInWithPassword(body);
    if (error || !data.session) throw new HttpError(401, error?.message ?? "Login failed");
    res.json({ user: data.user, session: data.session });
  } catch (error) {
    sendError(res, error);
  }
});

function isMissingUserColumn(error: { message?: string } | null): boolean {
  return Boolean(error?.message && /is_admin|phone|user_code/i.test(error.message));
}

const MIGRATION_009 = "009_user_avatar.sql";

/** The picture is optional: without migration 009 the profile simply has none. */
async function loadAvatar(id: string): Promise<string | null> {
  const { data, error } = await supabase.from("users").select("avatar").eq("id", id).maybeSingle();
  if (error) {
    if (!/avatar/i.test(error.message)) console.warn(`Profile loaded without a picture: ${error.message}`);
    return null;
  }
  return (data?.avatar as string | null | undefined) ?? null;
}

async function loadUserProfile(id: string) {
  type UserRow = {
    id: string;
    user_code?: string | null;
    email: string;
    full_name: string;
    phone?: string;
    credits: number;
    is_admin?: boolean;
    created_at?: string;
  };
  let result = await supabase.from("users").select("id,user_code,email,full_name,phone,credits,is_admin,created_at").eq("id", id).single();
  if (isMissingUserColumn(result.error)) {
    const withAdmin = await supabase.from("users").select("id,email,full_name,credits,is_admin,created_at").eq("id", id).single();
    if (!isMissingUserColumn(withAdmin.error)) {
      result = { ...withAdmin, data: withAdmin.data ? { ...withAdmin.data, phone: "", user_code: null } : null } as typeof result;
    } else {
      const base = await supabase.from("users").select("id,email,full_name,credits,created_at").eq("id", id).single();
      result = { ...base, data: base.data ? { ...base.data, phone: "", is_admin: false, user_code: null } : null } as typeof result;
    }
  }
  if (result.error || !result.data) throw result.error ?? new HttpError(404, "User not found");
  const row = result.data as UserRow;
  let phone = row.phone ?? "";
  let userCode = row.user_code && /^[0-9]{7,8}$/.test(row.user_code) ? row.user_code : "";
  if (!phone || !userCode) {
    const authUser = await supabase.auth.admin.getUserById(id).catch(() => null);
    const metaPhone = authUser?.data?.user?.user_metadata?.phone;
    const metaCode = authUser?.data?.user?.user_metadata?.user_code;
    if (!phone && typeof metaPhone === "string") phone = metaPhone;
    if (!userCode && typeof metaCode === "string" && /^[0-9]{7,8}$/.test(metaCode)) userCode = metaCode;
  }
  if (!userCode) {
    userCode = deriveUserCode(row.id);
    void supabase.from("users").update({ user_code: userCode }).eq("id", row.id);
  }
  return {
    id: row.id,
    user_code: userCode,
    email: row.email,
    full_name: row.full_name,
    phone,
    credits: row.credits,
    is_admin: Boolean(row.is_admin),
    created_at: row.created_at,
    avatar: await loadAvatar(row.id),
    payments_enabled: paymentsEnabled
  };
}

const updateProfileSchema = z.object({
  full_name: z.string().trim().min(1, "Vui lòng nhập họ và tên").max(120),
  phone: z.string().trim().max(30).optional().default(""),
  email: z.string().trim().toLowerCase().email("Địa chỉ email không hợp lệ").max(320).optional()
});

const updatePasswordSchema = z.object({
  current_password: z.string().min(1).max(128),
  new_password: z.string().min(8).max(128)
});

router.get("/user/me", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    res.json({ user: await loadUserProfile(userId(req)) });
  } catch (error) {
    sendError(res, error);
  }
});

router.put("/user/me", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const id = userId(req);
    const body = parseBody(updateProfileSchema, req.body);
    const normalizedPhone = body.phone.replace(/[\s.()-]/g, "");
    if (normalizedPhone && !/^(?:\+?84|0)(?:[35789]\d{8}|2\d{9})$/.test(normalizedPhone)) {
      throw new HttpError(400, "Số điện thoại chưa đúng định dạng Việt Nam (ví dụ: 0912345678 hoặc +84912345678).");
    }

    const current = await loadUserProfile(id);
    // Changing the login email needs codes sent to the old and new address, which the profile page
    // does through Supabase Auth. Changing it here would skip that proof of ownership.
    if (body.email && body.email !== current.email.toLowerCase()) {
      throw new HttpError(400, "Đổi email cần xác nhận bằng mã gửi tới email. Hãy dùng mục Đổi email trong trang Hồ sơ.");
    }

    const authUser = await supabase.auth.admin.getUserById(id).catch(() => null);
    const existingMeta = (authUser?.data?.user?.user_metadata ?? {}) as Record<string, unknown>;
    const { error: authUpdateError } = await supabase.auth.admin.updateUserById(id, {
      user_metadata: { ...existingMeta, full_name: body.full_name, phone: normalizedPhone }
    });
    if (authUpdateError) throw new HttpError(400, authUpdateError.message);

    let updateRes = await supabase
      .from("users")
      .update({ full_name: body.full_name, phone: normalizedPhone })
      .eq("id", id);

    if (updateRes.error && /phone/i.test(updateRes.error.message)) {
      updateRes = await supabase
        .from("users")
        .update({ full_name: body.full_name })
        .eq("id", id);
    }
    if (updateRes.error) throw updateRes.error;

    res.json({
      user: await loadUserProfile(id),
      message: "Đã cập nhật thông tin hồ sơ thành công."
    });
  } catch (error) {
    sendError(res, error);
  }
});

router.put("/user/avatar", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const body = parseBody(z.object({ avatar: imageDataUrlSchema.or(z.literal("")) }), req.body);
    const { error } = await supabase.from("users").update({ avatar: body.avatar || null }).eq("id", userId(req));
    if (error && /avatar/i.test(error.message)) {
      throw new HttpError(503, `Ảnh đại diện cần chạy migration ${MIGRATION_009} trước.`);
    }
    if (error) throw error;
    res.json({ user: await loadUserProfile(userId(req)) });
  } catch (error) {
    sendError(res, error);
  }
});

router.put("/user/password", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const id = userId(req);
    const body = parseBody(updatePasswordSchema, req.body);
    if (body.current_password === body.new_password) {
      throw new HttpError(400, "Mật khẩu mới phải khác mật khẩu hiện tại.");
    }
    const current = await loadUserProfile(id);
    const { error: verifyError } = await authClient.auth.signInWithPassword({
      email: current.email,
      password: body.current_password
    });
    if (verifyError) {
      throw new HttpError(401, "Mật khẩu hiện tại không chính xác.");
    }
    const { error: updateError } = await supabase.auth.admin.updateUserById(id, {
      password: body.new_password
    });
    if (updateError) throw new HttpError(400, updateError.message);
    res.json({ updated: true, message: "Đã đổi mật khẩu thành công." });
  } catch (error) {
    sendError(res, error);
  }
});

/** Copies the login email into public.users after a confirmed change; migration 008 does the same in the database. */
router.post("/user/email/sync", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const id = userId(req);
    const { data, error } = await supabase.auth.admin.getUserById(id);
    if (error || !data.user?.email) throw new HttpError(502, "Không đọc được email đăng nhập.");
    const { error: updateError } = await supabase.from("users").update({ email: data.user.email }).eq("id", id);
    if (updateError) throw updateError;
    res.json({ user: await loadUserProfile(id) });
  } catch (error) {
    sendError(res, error);
  }
});

/** Reads the flag from the database on every request, so a revoked admin loses access at once. */
async function requireAdmin(req: AuthenticatedRequest, _res: Response, next: NextFunction): Promise<void> {
  try {
    const { data, error } = await supabase.from("users").select("is_admin").eq("id", userId(req)).maybeSingle();
    if (isMissingAdminColumn(error)) {
      throw new HttpError(503, `Chức năng quản trị chưa sẵn sàng. Hãy chạy migration ${MIGRATION_007} trước.`);
    }
    if (error) throw error;
    if (!data?.is_admin) {
      throw new HttpError(403, "Chỉ tài khoản quản trị (Admin) mới có quyền truy cập trang thống kê này.");
    }
    next();
  } catch (error) {
    next(error);
  }
}

router.get("/admin/overview", requireAuth, requireAdmin, async (_req, res) => {
  try {
    res.json({ overview: await fetchAdminOverview() });
  } catch (error) {
    sendError(res, error);
  }
});

const adminUserListSchema = z.object({
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1)
});

router.get("/admin/users", requireAuth, requireAdmin, async (req, res) => {
  try {
    const parsed = adminUserListSchema.safeParse(req.query);
    if (!parsed.success) throw new HttpError(400, "Invalid user filters");
    res.json(await listAdminUsers(parsed.data.q, parsed.data.page));
  } catch (error) {
    sendError(res, error);
  }
});

const adminDaysSchema = z.object({ days: z.coerce.number().int().refine((value) => [7, 30, 90].includes(value)).default(30) });

router.get("/admin/activity", requireAuth, requireAdmin, async (req, res) => {
  try {
    const parsed = adminDaysSchema.safeParse(req.query);
    if (!parsed.success) throw new HttpError(400, "days must be 7, 30 or 90");
    res.json({ activity: await fetchAdminActivity(parsed.data.days) });
  } catch (error) {
    sendError(res, error);
  }
});

router.get("/admin/ai-usage", requireAuth, requireAdmin, async (req, res) => {
  try {
    const parsed = adminDaysSchema.safeParse(req.query);
    if (!parsed.success) throw new HttpError(400, "days must be 7, 30 or 90");
    res.json({ report: await fetchAiUsageReport(parsed.data.days) });
  } catch (error) {
    sendError(res, error);
  }
});

router.get("/admin/users/:userId", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = z.string().uuid().safeParse(req.params.userId);
    if (!id.success) throw new HttpError(400, "Invalid user id");
    res.json({ detail: await fetchAdminUserDetail(id.data) });
  } catch (error) {
    sendError(res, error);
  }
});

const adminTransactionListSchema = z.object({
  status: z.enum(["PENDING", "SUCCESS", "CANCELLED"]).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1)
});

router.get("/admin/transactions", requireAuth, requireAdmin, async (req, res) => {
  try {
    const parsed = adminTransactionListSchema.safeParse(req.query);
    if (!parsed.success) throw new HttpError(400, "Invalid transaction filters");
    res.json(await listAdminTransactions(parsed.data.status, parsed.data.page));
  } catch (error) {
    sendError(res, error);
  }
});

router.get("/admin/jobs", requireAuth, requireAdmin, async (_req, res) => {
  try {
    res.json({ stats: await fetchAdminJobStats() });
  } catch (error) {
    sendError(res, error);
  }
});

router.post("/cv/upload", requireAuth, upload.single("file"), async (req: AuthenticatedRequest, res) => {
  try {
    const file = req.file;
    if (!file) throw new HttpError(400, "Choose a PDF file to upload");
    if (!file.buffer.subarray(0, 1024).toString("latin1").includes("%PDF-")) {
      throw new HttpError(400, "The uploaded file is not a valid PDF");
    }

    // The package entry runs a debug self-test when loaded through import() (as the built API
    // does), reading a test PDF that is not installed; the library file has no such code.
    const pdfParse = (await import("pdf-parse/lib/pdf-parse.js")).default;
    let parsed: Awaited<ReturnType<typeof pdfParse>>;
    try {
      parsed = await pdfParse(file.buffer);
    } catch {
      throw new HttpError(422, "Could not read this PDF. Please export it again as a text-based PDF.");
    }
    const rawText = stripNul(parsed.text).trim();
    if (rawText.length < 40) {
      throw new HttpError(422, "Could not extract readable text. Please use a text-based PDF CV.");
    }
    const maskedText = maskText(rawText);
    const { data, error } = await supabase
      .from("cv_documents")
      .insert({
        user_id: userId(req),
        original_name: file.originalname.slice(0, 255),
        raw_text: rawText,
        masked_text: maskedText
      })
      .select("id,original_name,created_at")
      .single();
    if (error) throw error;
    res.status(201).json({ cv_id: data.id, cv: data });
  } catch (error) {
    sendError(res, error);
  }
});

function cvTextColumns(cv: CvData) {
  const rawText = cvDataToText(cv);
  return { raw_text: rawText, masked_text: maskText(rawText), cv_data: cv };
}

function isMissingCvDataColumn(error: { message?: string } | null): boolean {
  return !!error?.message?.includes("cv_data");
}

router.post("/cv/create", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = cvDataSchema.safeParse(req.body?.cv_data ?? emptyCvData());
    if (!parsed.success) throw new HttpError(400, "Invalid CV data");
    const columns = cvTextColumns(parsed.data);
    const row = { user_id: userId(req), original_name: parsed.data.personal_info.name ? `CV ${parsed.data.personal_info.name}`.slice(0, 255) : "CV tạo trên nền tảng" };
    let result = await supabase.from("cv_documents").insert({ ...row, ...columns }).select("id").single();
    if (isMissingCvDataColumn(result.error)) {
      const { cv_data: _omit, ...withoutCvData } = columns;
      void _omit;
      result = await supabase.from("cv_documents").insert({ ...row, ...withoutCvData }).select("id").single();
    }
    if (result.error) throw result.error;
    res.status(201).json({ cv_id: result.data.id, cv_data: parsed.data });
  } catch (error) {
    sendError(res, error);
  }
});

router.get("/cv", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { page, from, to } = listPage(req.query);
    const { data, error, count } = await supabase
      .from("cv_documents")
      .select("id,original_name,created_at", { count: "exact" })
      .eq("user_id", userId(req))
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, to);
    if (pageError(error)) throw error;
    res.json({ cvs: data ?? [], total: count ?? 0, page, page_size: LIST_PAGE_SIZE });
  } catch (error) {
    sendError(res, error);
  }
});

/** Removing a CV also removes its analyses, quality checks and interview sessions (ON DELETE CASCADE). */
router.delete("/cv/:cvId", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const cvId = z.string().uuid().safeParse(req.params.cvId);
    if (!cvId.success) throw new HttpError(400, "Invalid CV ID");
    const { data, error } = await supabase.from("cv_documents").delete()
      .eq("id", cvId.data).eq("user_id", userId(req)).select("id").maybeSingle();
    if (error) throw error;
    if (!data) throw new HttpError(404, "CV not found");
    res.json({ deleted: true });
  } catch (error) {
    sendError(res, error);
  }
});

router.get("/cv/:cvId", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const cvId = z.string().uuid().safeParse(req.params.cvId);
    if (!cvId.success) throw new HttpError(400, "Invalid CV ID");
    let result = await supabase.from("cv_documents").select("id,original_name,cv_data,masked_text,raw_text")
      .eq("id", cvId.data).eq("user_id", userId(req)).maybeSingle();
    if (isMissingCvDataColumn(result.error)) {
      const fallback = await supabase.from("cv_documents").select("id,original_name,masked_text,raw_text")
        .eq("id", cvId.data).eq("user_id", userId(req)).maybeSingle();
      result = { ...fallback, data: fallback.data ? { ...fallback.data, cv_data: null } : null } as typeof result;
    }
    if (result.error) throw result.error;
    if (!result.data) throw new HttpError(404, "CV not found");
    let cvData: CvData | null = result.data.cv_data ? cvDataSchema.parse(result.data.cv_data) : null;
    let structured = true;
    if (!cvData) {
      const maskedText = maskText(result.data.masked_text);
      try {
        cvData = await structureCV(maskedText);
      } catch (error) {
        console.error("CV structuring failed, using fallback", error);
        structured = false;
        cvData = { ...emptyCvData(), summary: maskedText.slice(0, 3000) };
      }
      cvData.personal_info = { ...cvData.personal_info, ...extractContacts(result.data.raw_text) };
      cvData.links = extractLinks(result.data.raw_text);
      // The fallback is not stored, so opening the CV again retries structuring.
      if (structured) {
        const saved = await supabase.from("cv_documents").update({ cv_data: cvData }).eq("id", cvId.data).eq("user_id", userId(req));
        if (saved.error && !isMissingCvDataColumn(saved.error)) console.error("Failed to store cv_data", saved.error);
      }
    }
    res.json({ cv_id: result.data.id, original_name: result.data.original_name, cv_data: cvData, structured });
  } catch (error) {
    sendError(res, error);
  }
});

router.put("/cv/:cvId", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const cvId = z.string().uuid().safeParse(req.params.cvId);
    if (!cvId.success) throw new HttpError(400, "Invalid CV ID");
    const parsed = cvDataSchema.safeParse(req.body?.cv_data);
    if (!parsed.success) throw new HttpError(400, "Invalid CV data");
    const columns = cvTextColumns(parsed.data);
    const update = (values: Record<string, unknown>) => supabase
      .from("cv_documents")
      .update(values)
      .eq("id", cvId.data)
      .eq("user_id", userId(req))
      .select("id")
      .maybeSingle();
    let result = await update(columns);
    if (isMissingCvDataColumn(result.error)) {
      const { cv_data: _omit, ...withoutCvData } = columns;
      void _omit;
      result = await update(withoutCvData);
    }
    if (result.error) throw result.error;
    if (!result.data) throw new HttpError(404, "CV not found");
    res.json({ saved: true });
  } catch (error) {
    sendError(res, error);
  }
});

router.post("/cv/:cvId/evaluate", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const cvId = z.string().uuid().safeParse(req.params.cvId);
    if (!cvId.success) throw new HttpError(400, "Invalid CV ID");
    const ownerId = userId(req);
    const { data: row, error } = await supabase.from("cv_documents")
      .select("id,raw_text,masked_text,cv_data")
      .eq("id", cvId.data).eq("user_id", ownerId).maybeSingle();
    if (error) throw error;
    if (!row) throw new HttpError(404, "CV not found");
    const maskedText = maskText(row.masked_text);
    const parsed = cvDataSchema.safeParse(row.cv_data);
    let cv = parsed.success ? parsed.data : null;
    if (!cv) {
      try {
        cv = await structureCV(maskedText);
      } catch (error) {
        console.error("CV structuring unavailable during quality check", error);
        cv = { ...emptyCvData(), summary: maskedText.slice(0, 3000) };
      }
    }
    if (!parsed.success) cv.personal_info = { ...cv.personal_info, ...extractContacts(row.raw_text) };
    const ruleResult = inspectCvQuality(cv, row.raw_text);
    let aiIssues: Awaited<ReturnType<typeof generateCvQualityFeedback>> = [];
    let aiAvailable = true;
    try {
      aiIssues = await generateCvQualityFeedback(maskedText);
    } catch (error) {
      console.error("AI quality feedback unavailable", error);
      aiAvailable = false;
    }
    const issues = [...ruleResult.issues, ...aiIssues];
    const qualityScore = scoreQualityIssues(issues);
    const { data: saved, error: saveError } = await supabase.from("cv_evaluations")
      .insert({ user_id: ownerId, cv_id: cvId.data, quality_score: qualityScore, issues })
      .select("id,created_at").single();
    if (saveError) throw saveError;
    res.json({ evaluation_id: saved.id, created_at: saved.created_at,
      quality_score: qualityScore, issues,
      note: aiAvailable
        ? "Kiểm tra trình bày dựa trên văn bản trích xuất, chưa đánh giá thiết kế thị giác của PDF."
        : "Chỉ có kết quả kiểm tra theo quy tắc; AI hiện chưa khả dụng. Chưa đánh giá thiết kế thị giác của PDF." });
  } catch (error) {
    sendError(res, error);
  }
});

router.get("/cv/:cvId/evaluations", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const cvId = z.string().uuid().safeParse(req.params.cvId);
    if (!cvId.success) throw new HttpError(400, "Invalid CV ID");
    const { data, error } = await supabase.from("cv_evaluations")
      .select("id,quality_score,issues,created_at").eq("cv_id", cvId.data)
      .eq("user_id", userId(req)).order("created_at", { ascending: false }).limit(10);
    if (error) throw error;
    res.json({ evaluations: data });
  } catch (error) {
    sendError(res, error);
  }
});

router.get("/evaluations", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { page, from, to } = listPage(req.query);
    const base = "id,cv_id,quality_score,created_at";
    const list = (columns: string) => supabase.from("cv_evaluations").select(columns, { count: "exact" })
      .eq("user_id", userId(req)).order("created_at", { ascending: false }).order("id").range(from, to);
    let result = await list(`${base},cv_documents!cv_evaluations_cv_id_fkey(original_name)`);
    if (result.error && result.error.code !== "PGRST103") {
      console.warn(`Listing CV evaluations without CV names: ${result.error.message}`);
      result = await list(base);
    }
    if (pageError(result.error)) throw result.error;
    type Row = { id: string; cv_id: string; quality_score: number; created_at: string;
      cv_documents?: { original_name: string } | { original_name: string }[] | null };
    res.json({
      evaluations: ((result.data ?? []) as unknown as Row[]).map(({ cv_documents, ...item }) => ({
        ...item, cv_name: embedded(cv_documents)?.original_name ?? null
      })),
      total: result.count ?? 0, page, page_size: LIST_PAGE_SIZE
    });
  } catch (error) {
    sendError(res, error);
  }
});

router.post("/ai/rewrite-section", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const body = parseBody(rewriteSectionSchema, req.body);
    res.json({ new_description: await rewriteSection(body) });
  } catch (error) {
    sendError(res, error);
  }
});

// Divides evenly into the job grid's 2, 3 or 4 columns.
const JOB_PAGE_SIZE = 24;
const jobListSchema = z.object({
  q: z.string().trim().max(100).optional(),
  city: z.string().trim().max(40).optional(),
  saved: z.enum(["1", "true", "0", "false"]).optional(),
  category: z.enum(JOB_CATEGORY_FILTERS).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1)
});

function jobStoreError(error: { code?: string }) {
  return error.code === "PGRST205"
    ? new HttpError(503, "Kho việc làm chưa sẵn sàng. Hãy chạy migration 004_job_postings.sql rồi chạy npm run jobs:sync.")
    : error;
}

// 42703 / PGRST202: the category column or the count function from migration 010 is missing.
function jobCategoryError(error: { code?: string }) {
  return error.code === "42703" || error.code === "PGRST202"
    ? new HttpError(503, "Danh mục nghề nghiệp chưa sẵn sàng. Hãy chạy migration 010_job_categories.sql rồi chạy npm run jobs:sync.")
    : jobStoreError(error);
}

async function countJobsByCategory(city: string | undefined) {
  const { data, error } = await supabase.rpc("job_category_counts", { p_city: city || null });
  if (error) throw jobCategoryError(error);
  const totals = new Map((data as { category: string; total: number }[] ?? []).map((row) => [row.category, Number(row.total)]));
  // Every occupation is listed, including ones with no postings yet.
  return JOB_CATEGORY_GROUPS.map((group) => {
    const categories = group.categories.map(({ id, label }) => ({ id, label, count: totals.get(id) ?? 0 }));
    return { id: group.id, label: group.label, count: categories.reduce((sum, item) => sum + item.count, 0), categories };
  });
}

function isMissingSavedJobsTable(error: { code?: string; message?: string } | null): boolean {
  return Boolean(error && (error.code === "PGRST205" || /saved_jobs/i.test(error.message ?? "")));
}

async function loadSavedJobIds(ownerId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("saved_jobs")
    .select("job_id,created_at")
    .eq("user_id", ownerId)
    .order("created_at", { ascending: false });

  if (!error && data) {
    return data.map((row) => String(row.job_id));
  }
  if (error && !isMissingSavedJobsTable(error)) {
    throw error;
  }

  const authUser = await supabase.auth.admin.getUserById(ownerId).catch(() => null);
  const metaIds = authUser?.data?.user?.user_metadata?.saved_job_ids;
  if (Array.isArray(metaIds)) {
    return metaIds.filter((item): item is string => typeof item === "string" && z.string().uuid().safeParse(item).success);
  }
  return [];
}

async function syncSavedJobMetadata(ownerId: string, nextIds: string[]) {
  const authUser = await supabase.auth.admin.getUserById(ownerId).catch(() => null);
  const existingMeta = (authUser?.data?.user?.user_metadata ?? {}) as Record<string, unknown>;
  await supabase.auth.admin.updateUserById(ownerId, {
    user_metadata: { ...existingMeta, saved_job_ids: nextIds.slice(0, 200) }
  }).catch(() => null);
}

async function getJobPosting(id: string) {
  const { data, error } = await supabase.from("job_postings")
    .select("id,company,title,location,city,url,posted_at,description").eq("id", id).maybeSingle();
  if (error) throw jobStoreError(error);
  if (!data) throw new HttpError(404, "Job posting not found");
  return data;
}

router.get("/jobs", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = jobListSchema.safeParse(req.query);
    if (!parsed.success) throw new HttpError(400, "Invalid job filters");
    const { q, city, saved, category, page } = parsed.data;
    const onlySaved = saved === "1" || saved === "true";
    const savedIds = await loadSavedJobIds(userId(req));

    if (onlySaved && savedIds.length === 0) {
      res.json({ jobs: [], total: 0, page, page_size: JOB_PAGE_SIZE, saved_ids: [] });
      return;
    }

    let query = supabase.from("job_postings")
      .select("id,company,title,location,city,url,posted_at,category", { count: "exact" })
      .eq("is_active", true);
    if (onlySaved) {
      query = query.in("id", savedIds);
    }
    // These characters are syntax inside PostgREST's or() filter. Each word must appear in the
    // title, company or description, so "backend typescript" finds postings asking for both.
    const words = (q ?? "").replace(/[%_,()*\\"':]/g, " ").split(/\s+/u).filter(Boolean).slice(0, 5);
    for (const word of words) {
      query = query.or(`title.ilike.%${word}%,company.ilike.%${word}%,description.ilike.%${word}%`);
    }
    if (city) query = query.eq("city", city);
    if (category) query = query.in("category", categoriesOfFilter(category));
    const from = (page - 1) * JOB_PAGE_SIZE;
    const [{ data, error, count }, categoryGroups] = await Promise.all([
      query.order("posted_at", { ascending: false, nullsFirst: false }).order("id").range(from, from + JOB_PAGE_SIZE - 1),
      countJobsByCategory(city),
    ]);
    // PGRST103: the requested page is past the last result.
    if (error && error.code !== "PGRST103") throw jobCategoryError(error);
    res.json({ jobs: data ?? [], total: count ?? 0, page, page_size: JOB_PAGE_SIZE, saved_ids: savedIds, category_groups: categoryGroups });
  } catch (error) {
    sendError(res, error);
  }
});

router.post("/jobs/:jobId/save", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const jobId = z.string().uuid().safeParse(req.params.jobId);
    if (!jobId.success) throw new HttpError(400, "Invalid job ID");
    const ownerId = userId(req);
    await getJobPosting(jobId.data);

    const { error } = await supabase
      .from("saved_jobs")
      .upsert({ user_id: ownerId, job_id: jobId.data }, { onConflict: "user_id,job_id" });
    if (error && !isMissingSavedJobsTable(error)) throw error;

    const currentIds = await loadSavedJobIds(ownerId);
    const nextIds = [jobId.data, ...currentIds.filter((id) => id !== jobId.data)];
    await syncSavedJobMetadata(ownerId, nextIds);

    res.json({ saved: true, saved_ids: nextIds });
  } catch (error) {
    sendError(res, error);
  }
});

router.delete("/jobs/:jobId/save", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const jobId = z.string().uuid().safeParse(req.params.jobId);
    if (!jobId.success) throw new HttpError(400, "Invalid job ID");
    const ownerId = userId(req);

    const { error } = await supabase
      .from("saved_jobs")
      .delete()
      .eq("user_id", ownerId)
      .eq("job_id", jobId.data);
    if (error && !isMissingSavedJobsTable(error)) throw error;

    const currentIds = await loadSavedJobIds(ownerId);
    const nextIds = currentIds.filter((id) => id !== jobId.data);
    await syncSavedJobMetadata(ownerId, nextIds);

    res.json({ saved: false, saved_ids: nextIds });
  } catch (error) {
    sendError(res, error);
  }
});

router.get("/jobs/:jobId", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const jobId = z.string().uuid().safeParse(req.params.jobId);
    if (!jobId.success) throw new HttpError(400, "Invalid job ID");
    res.json({ job: await getJobPosting(jobId.data) });
  } catch (error) {
    sendError(res, error);
  }
});

const analysisSchema = z.object({
  cv_id: z.string().uuid(),
  jd_text: z.string().trim().min(50).max(20_000).optional(),
  job_id: z.string().uuid().optional()
}).refine((body) => body.jd_text || body.job_id, { message: "Provide a job description" });

router.post("/analyze", requireAuth, async (req: AuthenticatedRequest, res) => {
  const ownerId = userId(req);
  let creditConsumed = false;
  try {
    const body = parseBody(analysisSchema, req.body);
    const { data: cv, error: cvError } = await supabase
      .from("cv_documents")
      .select("id,masked_text")
      .eq("id", body.cv_id)
      .eq("user_id", ownerId)
      .single();
    if (cvError || !cv) throw new HttpError(404, "CV not found");
    const job = body.job_id
      ? await getJobPosting(body.job_id).catch((error: unknown) => {
        // A pasted JD can still be analyzed after its posting is gone.
        if (body.jd_text && error instanceof HttpError && error.status === 404) return null;
        throw error;
      })
      : null;
    const jdText = body.jd_text ?? job?.description ?? "";
    // An edited JD no longer describes the posting, so the report is not linked to it.
    const linkedJob = job && normalizeEvidence(jdText) === normalizeEvidence(job.description) ? job : null;

    let remainingCredits: number | null = null;
    if (paymentsEnabled) {
      const { data, error } = await supabase.rpc("consume_credit", { p_user_id: ownerId });
      if (error) throw error;
      if (data === null) throw new HttpError(402, "No analysis credits remaining");
      remainingCredits = data;
      creditConsumed = true;
    }

    const analysis = await analyzeCVvsJD(maskText(cv.masked_text), jdText);
    const premiumUnlocked = true;
    const { data: saved, error: saveError } = await supabase
      .from("analyses")
      .insert({
        user_id: ownerId,
        cv_id: body.cv_id,
        jd_text: jdText,
        ...(linkedJob ? { job_id: linkedJob.id } : {}),
        rci_score: analysis.rci_score,
        layer_1_skills: analysis.layer_1_skills,
        layer_2_projects: analysis.layer_2_projects,
        layer_3_education: analysis.layer_3_education,
        layer_4_mock: premiumUnlocked ? analysis.layer_4_mock : null,
        is_premium_unlocked: premiumUnlocked,
        requirements: analysis.requirements,
        scoring_breakdown: analysis.scoring_breakdown
      })
      .select("id,created_at")
      .single();
    if (saveError) throw saveError;

    res.json({
      analysis_id: saved.id,
      job_id: linkedJob?.id ?? null,
      ...analysis,
      layer_4_mock: premiumUnlocked ? analysis.layer_4_mock : null,
      is_premium_unlocked: premiumUnlocked,
      credits_remaining: remainingCredits
    });
  } catch (error) {
    if (creditConsumed) {
      const { error: refundError } = await supabase.rpc("refund_credit", { p_user_id: ownerId });
      if (refundError) console.error("Failed to refund analysis credit", { ownerId, refundError });
    }
    sendError(res, error);
  }
});

type AnalysisListRow = {
  id: string; cv_id: string; job_id?: string | null; jd_text: string; rci_score: number; created_at: string;
  cv_documents: { original_name: string } | { original_name: string }[] | null;
  job_postings?: { title: string; company: string } | { title: string; company: string }[] | null;
};

router.get("/analyses", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { page, from, to } = listPage(req.query);
    const list = (columns: string) => supabase.from("analyses").select(columns, { count: "exact" })
      .eq("user_id", userId(req)).order("created_at", { ascending: false }).order("id").range(from, to);
    // analyses reaches cv_documents directly and through interview_sessions, so the joins name their
    // foreign keys. Without migration 004 there is no job link; the list then loads without it.
    const base = "id,cv_id,jd_text,rci_score,created_at";
    const withCv = `${base},cv_documents!analyses_cv_id_fkey(original_name)`;
    let result = await list(`${withCv},job_id,job_postings!analyses_job_id_fkey(title,company)`);
    for (const fallback of [withCv, base]) {
      if (!result.error || result.error.code === "PGRST103") break;
      console.warn(`Listing analyses with fewer joins: ${result.error.message}`);
      result = await list(fallback);
    }
    if (pageError(result.error)) throw result.error;
    const rows = (result.data ?? []) as unknown as AnalysisListRow[];
    res.json({
      analyses: rows.map((row) => {
        const job = embedded(row.job_postings);
        return {
          id: row.id, cv_id: row.cv_id, rci_score: row.rci_score, created_at: row.created_at,
          job_id: row.job_id ?? null,
          jd_preview: row.jd_text.slice(0, 120),
          cv_name: embedded(row.cv_documents)?.original_name ?? null,
          job: job ? { title: job.title, company: job.company } : null
        };
      }),
      total: result.count ?? 0, page, page_size: LIST_PAGE_SIZE
    });
  } catch (error) {
    sendError(res, error);
  }
});

router.get("/analyses/:analysisId", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const analysisId = z.string().uuid().safeParse(req.params.analysisId);
    if (!analysisId.success) throw new HttpError(400, "Invalid analysis ID");
    const { data, error } = await supabase.from("analyses").select("*")
      .eq("id", analysisId.data).eq("user_id", userId(req)).maybeSingle();
    if (error) throw error;
    if (!data) throw new HttpError(404, "Analysis not found");
    res.json({ analysis: { ...data, analysis_id: data.id } });
  } catch (error) {
    sendError(res, error);
  }
});

router.post("/analyses/:analysisId/unlock", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const analysisId = z.string().uuid().safeParse(req.params.analysisId);
    if (!analysisId.success) throw new HttpError(400, "Invalid analysis ID");
    const ownerId = userId(req);
    const { data: analysis, error: analysisError } = await supabase
      .from("analyses")
      .select("id,cv_id,jd_text,layer_4_mock")
      .eq("id", analysisId.data)
      .eq("user_id", ownerId)
      .single();
    if (analysisError || !analysis) throw new HttpError(404, "Analysis not found");
    if (analysis.layer_4_mock) {
      if (!paymentsEnabled) {
        res.json({ layer_4_mock: analysis.layer_4_mock, credits_remaining: null, already_unlocked: true });
        return;
      }
      const { data: profile, error: profileError } = await supabase
        .from("users")
        .select("credits")
        .eq("id", ownerId)
        .single();
      if (profileError) throw profileError;
      res.json({ layer_4_mock: analysis.layer_4_mock, credits_remaining: profile.credits, already_unlocked: true });
      return;
    }

    const { data: cv, error: cvError } = await supabase
      .from("cv_documents")
      .select("masked_text")
      .eq("id", analysis.cv_id)
      .eq("user_id", ownerId)
      .single();
    if (cvError || !cv) throw new HttpError(404, "CV not found");
    const questions = await generateMockQuestions(maskText(cv.masked_text), analysis.jd_text);
    if (!paymentsEnabled) {
      const { error: updateError } = await supabase.from("analyses")
        .update({ layer_4_mock: questions, is_premium_unlocked: true })
        .eq("id", analysis.id).eq("user_id", ownerId);
      if (updateError) throw updateError;
      res.json({ layer_4_mock: questions, credits_remaining: null, already_unlocked: false });
      return;
    }
    const { data: unlocked, error: unlockError } = await supabase.rpc("unlock_analysis", {
      p_user_id: ownerId,
      p_analysis_id: analysis.id,
      p_questions: questions
    });
    if (unlockError) {
      if (unlockError.message.includes("INSUFFICIENT_CREDITS")) {
        throw new HttpError(402, "A credit is required to unlock the mock interview");
      }
      if (unlockError.message.includes("ANALYSIS_NOT_FOUND")) throw new HttpError(404, "Analysis not found");
      throw unlockError;
    }
    res.json(unlocked);
  } catch (error) {
    sendError(res, error);
  }
});

router.post("/payment/create-qr", requireAuth, async (req: AuthenticatedRequest, res) => {
  let transactionId: string | undefined;
  try {
    if (!paymentsEnabled) throw new HttpError(503, "Payments are not enabled");
    const body = parseBody(z.object({ package: z.literal("premium_29k") }), req.body);
    void body;
    const ownerId = userId(req);
    const orderCode = Date.now() * 1000 + Math.floor(Math.random() * 1000);
    const { data: transaction, error: insertError } = await supabase
      .from("transactions")
      .insert({ user_id: ownerId, order_code: orderCode, amount: 29000 })
      .select("id")
      .single();
    if (insertError) throw insertError;
    transactionId = transaction.id;
    const payment = await createPayOSPayment(orderCode, 29000, `CVFIT ${String(orderCode).slice(-8)}`);
    res.status(201).json({ ...payment, order_code: orderCode, amount: 29000 });
  } catch (error) {
    if (transactionId) {
      const { error: updateError } = await supabase
        .from("transactions")
        .update({ status: "CANCELLED" })
        .eq("id", transactionId);
      if (updateError) console.error("Failed to cancel incomplete payment", updateError);
    }
    sendError(res, error);
  }
});

router.post("/payment/webhook", async (req, res) => {
  if (!config.PAYOS_CHECKSUM_KEY) {
    res.status(503).json({ code: "NOT_CONFIGURED", message: "PayOS webhook is not configured" });
    return;
  }
  if (!verifyPayOSWebhook(req.body)) {
    res.status(400).json({ code: "INVALID_SIGNATURE", message: "Invalid webhook signature" });
    return;
  }
  const { orderCode, amount, code } = req.body.data;
  if (code !== "00") {
    const { error } = await supabase
      .from("transactions")
      .update({ status: "CANCELLED" })
      .eq("order_code", orderCode)
      .eq("status", "PENDING");
    if (error) {
      console.error("Failed to mark unsuccessful PayOS payment", error);
      res.status(500).json({ code: "PROCESSING_ERROR", message: "Payment status could not be updated" });
      return;
    }
    res.json({ code: "00", message: "Payment not completed", data: null });
    return;
  }
  if (amount !== 29000) {
    res.status(400).json({ code: "INVALID_AMOUNT", message: "Unexpected payment amount" });
    return;
  }
  const { data: completed, error } = await supabase.rpc("complete_payment", {
    p_order_code: orderCode,
    p_amount: amount
  });
  if (error) {
    console.error("Failed to apply verified PayOS payment", error);
    res.status(500).json({ code: "PROCESSING_ERROR", message: "Payment could not be applied" });
    return;
  }
  if (!completed) {
    const { data: existing, error: lookupError } = await supabase
      .from("transactions")
      .select("status,amount")
      .eq("order_code", orderCode)
      .maybeSingle();
    if (lookupError) {
      console.error("Could not verify PayOS transaction state", lookupError);
      res.status(500).json({ code: "PROCESSING_ERROR", message: "Payment status could not be checked" });
      return;
    }
    if (existing?.status !== "SUCCESS" || existing.amount !== amount) {
      res.status(404).json({ code: "UNKNOWN_ORDER", message: "Payment order was not found" });
      return;
    }
  }
  res.json({ code: "00", message: "Payment processed", data: null });
});

router.get("/payment/:orderCode", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const parsedCode = z.coerce.number().int().positive().safeParse(req.params.orderCode);
    if (!parsedCode.success) throw new HttpError(400, "Invalid order code");
    const { data, error } = await supabase
      .from("transactions")
      .select("order_code,status,amount,created_at")
      .eq("order_code", parsedCode.data)
      .eq("user_id", userId(req))
      .single();
    if (error) throw new HttpError(404, "Payment order not found");
    res.json({ transaction: data });
  } catch (error) {
    sendError(res, error);
  }
});

const startInterviewSchema = z.union([
  z.object({ analysis_id: z.string().uuid() }),
  z.object({
    cv_id: z.string().uuid(),
    jd_text: z.string().trim().min(50).max(20_000),
    question_count: z.union([z.literal(3), z.literal(5)]).default(3)
  })
]);

const answerTextSchema = z.string().trim().min(20).max(5000);
const MIGRATION_005 = "005_interview_practice.sql";
let interviewPracticeReady = false;

/** Migration 005 adds answer history, follow-ups and longer sessions; until it runs those stay off. */
async function hasInterviewPractice(): Promise<boolean> {
  if (interviewPracticeReady) return true;
  const { error } = await supabase.from("interview_answers").select("previous_attempts,follow_up").limit(0);
  if (error && !/previous_attempts|follow_up|column/i.test(error.message)) throw error;
  interviewPracticeReady = !error;
  return interviewPracticeReady;
}

async function getInterview(sessionId: string, ownerId: string) {
  const parsed = z.string().uuid().safeParse(sessionId);
  if (!parsed.success) throw new HttpError(400, "Invalid interview session ID");
  const { data, error } = await supabase.from("interview_sessions").select("*")
    .eq("id", parsed.data).eq("user_id", ownerId).maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, "Interview session not found");
  return { ...data, questions: interviewQuestionsSchema.parse(data.questions) };
}

function questionIndex(value: unknown, total: number): number {
  const index = z.coerce.number().int().min(0).max(total - 1).safeParse(value);
  if (!index.success) throw new HttpError(400, "Invalid question index");
  return index.data;
}

async function cvTextFor(cvId: string, ownerId: string): Promise<string> {
  const { data: cv, error } = await supabase.from("cv_documents")
    .select("masked_text").eq("id", cvId).eq("user_id", ownerId).maybeSingle();
  if (error) throw error;
  if (!cv) throw new HttpError(404, "CV not found");
  return maskText(cv.masked_text);
}

router.post("/interviews", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const body = parseBody(startInterviewSchema, req.body);
    const ownerId = userId(req);
    if ("cv_id" in body) {
      if (body.question_count > 3 && !(await hasInterviewPractice())) {
        throw new HttpError(503, `Luyện ${body.question_count} câu cần chạy migration ${MIGRATION_005} trước.`);
      }
      const questions = await generateMockQuestions(await cvTextFor(body.cv_id, ownerId), body.jd_text, body.question_count);
      const { data, error: saveError } = await supabase.from("interview_sessions")
        .insert({ user_id: ownerId, cv_id: body.cv_id, jd_text: body.jd_text, questions })
        .select("id,questions,status,created_at").single();
      if (saveError?.code === "23502") {
        throw new HttpError(503, "Phỏng vấn nhanh cần chạy migration 004_job_postings.sql trước.");
      }
      if (saveError) throw saveError;
      res.status(201).json({ session: data });
      return;
    }
    const { data: analysis, error } = await supabase.from("analyses")
      .select("id,cv_id,jd_text,layer_4_mock").eq("id", body.analysis_id)
      .eq("user_id", ownerId).maybeSingle();
    if (error) throw error;
    if (!analysis) throw new HttpError(404, "Analysis not found");
    const parsed = interviewQuestionsSchema.safeParse(analysis.layer_4_mock);
    if (!parsed.success) throw new HttpError(402, "Hãy tạo câu hỏi phỏng vấn trong báo cáo trước khi bắt đầu luyện.");
    const { data: existing, error: existingError } = await supabase.from("interview_sessions")
      .select("id,questions,status,created_at").eq("analysis_id", analysis.id).eq("user_id", ownerId)
      .eq("status", "IN_PROGRESS").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (existingError) throw existingError;
    if (existing) {
      res.json({ session: existing });
      return;
    }
    const { data, error: saveError } = await supabase.from("interview_sessions")
      .insert({ user_id: ownerId, analysis_id: analysis.id, cv_id: analysis.cv_id,
        jd_text: analysis.jd_text, questions: parsed.data })
      .select("id,questions,status,created_at").single();
    if (saveError) throw saveError;
    res.status(201).json({ session: data });
  } catch (error) {
    sendError(res, error);
  }
});

type InterviewListRow = {
  id: string; analysis_id: string | null; status: string; created_at: string; completed_at: string | null;
  jd_text: string; questions: unknown[]; interview_answers: { evaluation: unknown }[];
  cv_documents?: { original_name: string } | { original_name: string }[] | null;
};

router.get("/interviews", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { page, from, to } = listPage(req.query);
    const base = "id,analysis_id,status,created_at,completed_at,jd_text,questions,interview_answers(evaluation)";
    const list = (columns: string) => supabase.from("interview_sessions").select(columns, { count: "exact" })
      .eq("user_id", userId(req)).order("created_at", { ascending: false }).order("id").range(from, to);
    let result = await list(`${base},cv_documents!interview_sessions_cv_id_fkey(original_name)`);
    if (result.error && result.error.code !== "PGRST103") {
      console.warn(`Listing interviews without CV names: ${result.error.message}`);
      result = await list(base);
    }
    if (pageError(result.error)) throw result.error;
    const rows = (result.data ?? []) as unknown as InterviewListRow[];
    res.json({
      sessions: rows.map(({ jd_text, questions, interview_answers, cv_documents, ...session }) => ({
        ...session,
        cv_name: embedded(cv_documents)?.original_name ?? null,
        jd_preview: jd_text.slice(0, 90),
        answered: interview_answers.length,
        total: questions.length,
        overall_score: overallScore(interview_answers, questions.length)
      })),
      total: result.count ?? 0, page, page_size: LIST_PAGE_SIZE
    });
  } catch (error) {
    sendError(res, error);
  }
});

router.get("/interviews/:sessionId", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const session = await getInterview(req.params.sessionId, userId(req));
    const columns = await hasInterviewPractice()
      ? "question_index,answer_text,evaluation,created_at,previous_attempts,follow_up"
      : "question_index,answer_text,evaluation,created_at";
    const { data: answers, error } = await supabase.from("interview_answers")
      .select(columns).eq("session_id", session.id).order("question_index", { ascending: true });
    if (error) throw error;
    const rows = (answers ?? []) as unknown as { evaluation: unknown }[];
    res.json({ session: { id: session.id, analysis_id: session.analysis_id,
      questions: session.questions, status: session.status, created_at: session.created_at,
      answers: rows, overall_score: overallScore(rows, session.questions.length) } });
  } catch (error) {
    sendError(res, error);
  }
});

router.get("/interviews/:sessionId/questions/:index/audio", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const session = await getInterview(req.params.sessionId, userId(req));
    const index = questionIndex(req.params.index, session.questions.length);
    let text = session.questions[index];
    if (req.query.follow_up === "1") {
      const { data, error } = await supabase.from("interview_answers").select("evaluation")
        .eq("session_id", session.id).eq("question_index", index).maybeSingle();
      if (error) throw error;
      const followUp = followUpQuestionOf(data?.evaluation);
      if (!followUp) throw new HttpError(404, "Câu hỏi nối tiếp không tồn tại");
      text = followUp;
    }
    const audio = await synthesizeQuestion(text);
    res.setHeader("Content-Type", "audio/wav");
    res.setHeader("Cache-Control", "private, max-age=600");
    res.send(audio);
  } catch (error) {
    sendError(res, error);
  }
});

router.post("/interviews/:sessionId/transcribe", requireAuth, audioUpload.single("audio"), async (req: AuthenticatedRequest, res) => {
  try {
    await getInterview(req.params.sessionId, userId(req));
    if (!req.file) throw new HttpError(400, "Choose an audio recording");
    const transcript = await transcribeAudio(req.file.buffer, req.file.mimetype.split(";")[0]);
    res.json({ transcript });
  } catch (error) {
    sendError(res, error);
  }
});

router.post("/interviews/:sessionId/answers", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const body = parseBody(z.object({
      question_index: z.number().int().min(0).max(MAX_QUESTIONS - 1),
      answer_text: answerTextSchema
    }), req.body);
    const ownerId = userId(req);
    const session = await getInterview(req.params.sessionId, ownerId);
    const index = questionIndex(body.question_index, session.questions.length);
    const evaluation = await evaluateInterviewAnswer({ question: session.questions[index],
      answer: body.answer_text, cvText: await cvTextFor(session.cv_id, ownerId), jdText: session.jd_text });
    let history = {};
    if (await hasInterviewPractice()) {
      const { data: existing, error } = await supabase.from("interview_answers")
        .select("answer_text,evaluation,created_at,previous_attempts,follow_up")
        .eq("session_id", session.id).eq("question_index", index).maybeSingle();
      if (error) throw error;
      // Answering again keeps the earlier attempt, so progress on the same question stays visible.
      history = {
        follow_up: null,
        previous_attempts: existing
          ? withPreviousAttempt(existing.previous_attempts, { answer_text: existing.answer_text,
            evaluation: existing.evaluation, follow_up: existing.follow_up ?? null, created_at: existing.created_at })
          : []
      };
    }
    const { error: saveError } = await supabase.from("interview_answers").upsert({
      session_id: session.id, question_index: index, answer_text: body.answer_text, evaluation,
      created_at: new Date().toISOString(), ...history
    }, { onConflict: "session_id,question_index" });
    if (saveError?.code === "23514") {
      throw new HttpError(503, `Phiên có hơn 3 câu hỏi cần chạy migration ${MIGRATION_005} trước.`);
    }
    if (saveError) throw saveError;
    const { data: answers, error: countError } = await supabase.from("interview_answers")
      .select("evaluation").eq("session_id", session.id);
    if (countError) throw countError;
    const completed = answers.length === session.questions.length;
    if (completed && session.status !== "COMPLETED") {
      const { error: completeError } = await supabase.from("interview_sessions")
        .update({ status: "COMPLETED", completed_at: new Date().toISOString() })
        .eq("id", session.id).eq("user_id", ownerId);
      if (completeError) throw completeError;
    }
    res.json({ evaluation, completed, overall_score: overallScore(answers, session.questions.length) });
  } catch (error) {
    sendError(res, error);
  }
});

router.post("/interviews/:sessionId/answers/:index/follow-up", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const body = parseBody(z.object({ answer_text: answerTextSchema }), req.body);
    const ownerId = userId(req);
    const session = await getInterview(req.params.sessionId, ownerId);
    const index = questionIndex(req.params.index, session.questions.length);
    if (!(await hasInterviewPractice())) {
      throw new HttpError(503, `Trả lời câu hỏi nối tiếp cần chạy migration ${MIGRATION_005} trước.`);
    }
    const { data: main, error } = await supabase.from("interview_answers")
      .select("answer_text,evaluation,created_at").eq("session_id", session.id).eq("question_index", index).maybeSingle();
    if (error) throw error;
    const question = followUpQuestionOf(main?.evaluation);
    if (!main || !question) throw new HttpError(404, "Câu hỏi nối tiếp không tồn tại");
    const evaluation = await evaluateInterviewAnswer({ question, answer: body.answer_text,
      cvText: await cvTextFor(session.cv_id, ownerId), jdText: session.jd_text,
      previous_exchange: { question: session.questions[index], answer: main.answer_text } });
    // One follow-up per answer: the follow-up's own suggested question is not kept.
    const followUp = { question, answer_text: body.answer_text,
      evaluation: { ...evaluation, follow_up_question: null }, created_at: new Date().toISOString() };
    // Matching created_at makes sure the main answer was not replaced while this one was graded.
    const { data: saved, error: saveError } = await supabase.from("interview_answers").update({ follow_up: followUp })
      .eq("session_id", session.id).eq("question_index", index).eq("created_at", main.created_at)
      .select("question_index").maybeSingle();
    if (saveError) throw saveError;
    if (!saved) throw new HttpError(409, "Câu trả lời chính vừa thay đổi. Hãy tải lại trang rồi trả lời câu hỏi nối tiếp mới.");
    res.json({ follow_up: followUp });
  } catch (error) {
    sendError(res, error);
  }
});

// Every typed question spends AI quota, so the chat has a tighter limit than the rest of the API.
const chatLimit = rateLimit({
  windowMs: 60_000,
  limit: 15,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => (req as AuthenticatedRequest).userId ?? req.ip ?? "",
  message: { error: "Bạn gửi tin nhắn hơi nhanh. Vui lòng chờ một phút rồi thử lại." }
});

router.post("/chat", requireAuth, chatLimit, async (req: AuthenticatedRequest, res) => {
  try {
    const body = parseBody(chatRequestSchema, req.body);
    res.json({ reply: await chatReply(buildChatInput(body.messages, body.page)) });
  } catch (error) {
    // The chat box offers its common questions instead, so users need no detail about the outage.
    if (error instanceof HttpError && error.status === 503) {
      sendError(res, new HttpError(503, "Hỗ trợ AI tạm thời chưa khả dụng. Bạn có thể chọn một câu hỏi thường gặp bên dưới."));
      return;
    }
    sendError(res, error);
  }
});

export const apiRouter = router;
