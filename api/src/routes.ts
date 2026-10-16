import { Router, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import { analyzeCVvsJD, generateMockQuestions, rewriteSection, rewriteSectionSchema, structureCV } from "./aiService";
import { cvDataSchema, cvDataToText, emptyCvData, extractContacts, maskText, type CvData } from "./cvData";
import { requireAuth, type AuthenticatedRequest } from "./auth";
import { config } from "./config";
import { HttpError } from "./errors";
import { createPayOSPayment, verifyPayOSWebhook } from "./payments";
import { authClient, supabase } from "./supabase";
import { parseBody } from "./validation";

const router = Router();
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

router.get("/user/me", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const id = userId(req);
    const { data, error } = await supabase.from("users").select("id,email,full_name,credits").eq("id", id).single();
    if (error) throw error;
    res.json({ user: data });
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

    const pdfParse = (await import("pdf-parse")).default;
    let parsed: Awaited<ReturnType<typeof pdfParse>>;
    try {
      parsed = await pdfParse(file.buffer);
    } catch {
      throw new HttpError(422, "Could not read this PDF. Please export it again as a text-based PDF.");
    }
    const rawText = parsed.text.trim();
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
    const { data, error } = await supabase
      .from("cv_documents")
      .select("id,original_name,created_at")
      .eq("user_id", userId(req))
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw error;
    res.json({ cvs: data });
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
    if (!cvData) {
      try {
        cvData = await structureCV(result.data.masked_text);
      } catch (error) {
        console.error("CV structuring failed, using fallback", error);
        cvData = { ...emptyCvData(), summary: result.data.masked_text.slice(0, 3000) };
      }
      cvData.personal_info = { ...cvData.personal_info, ...extractContacts(result.data.raw_text) };
      const saved = await supabase.from("cv_documents").update({ cv_data: cvData }).eq("id", cvId.data).eq("user_id", userId(req));
      if (saved.error && !isMissingCvDataColumn(saved.error)) console.error("Failed to store cv_data", saved.error);
    }
    res.json({ cv_id: result.data.id, original_name: result.data.original_name, cv_data: cvData });
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

router.post("/ai/rewrite-section", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const body = parseBody(rewriteSectionSchema, req.body);
    res.json({ new_description: await rewriteSection(body) });
  } catch (error) {
    sendError(res, error);
  }
});

const analysisSchema = z.object({
  cv_id: z.string().uuid(),
  jd_text: z.string().trim().min(50).max(20_000)
});

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

    const { data: remainingCredits, error: creditError } = await supabase.rpc("consume_credit", { p_user_id: ownerId });
    if (creditError) throw creditError;
    if (remainingCredits === null) throw new HttpError(402, "No analysis credits remaining");
    creditConsumed = true;

    const analysis = await analyzeCVvsJD(cv.masked_text, body.jd_text);
    const premiumUnlocked = remainingCredits > 0;
    const { data: saved, error: saveError } = await supabase
      .from("analyses")
      .insert({
        user_id: ownerId,
        cv_id: body.cv_id,
        jd_text: body.jd_text,
        rci_score: analysis.rci_score,
        layer_1_skills: analysis.layer_1_skills,
        layer_2_projects: analysis.layer_2_projects,
        layer_3_education: analysis.layer_3_education,
        layer_4_mock: premiumUnlocked ? analysis.layer_4_mock : null,
        is_premium_unlocked: premiumUnlocked
      })
      .select("id,created_at")
      .single();
    if (saveError) throw saveError;

    res.json({
      analysis_id: saved.id,
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
    const questions = await generateMockQuestions(cv.masked_text, analysis.jd_text);
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

export const apiRouter = router;
