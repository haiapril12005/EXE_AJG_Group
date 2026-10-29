import { Router, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import { analyzeCVvsJD, evaluateInterviewAnswer, generateCvQualityFeedback, generateMockQuestions, rewriteSection, rewriteSectionSchema, structureCV } from "./aiService";
import { cvDataSchema, cvDataToText, emptyCvData, extractContacts, maskText, type CvData } from "./cvData";
import { inspectCvQuality, scoreQualityIssues } from "./cvQuality";
import { requireAuth, type AuthenticatedRequest } from "./auth";
import { config } from "./config";
import { HttpError } from "./errors";
import { createPayOSPayment, verifyPayOSWebhook } from "./payments";
import { authClient, supabase } from "./supabase";
import { parseBody } from "./validation";
import { synthesizeQuestion, transcribeAudio } from "./speech";

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
    const parsed = cvDataSchema.safeParse(row.cv_data);
    let cv = parsed.success ? parsed.data : null;
    if (!cv) {
      try {
        cv = await structureCV(row.masked_text);
      } catch (error) {
        console.error("CV structuring unavailable during quality check", error);
        cv = { ...emptyCvData(), summary: row.masked_text.slice(0, 3000) };
      }
    }
    if (!parsed.success) cv.personal_info = { ...cv.personal_info, ...extractContacts(row.raw_text) };
    const ruleResult = inspectCvQuality(cv, row.raw_text);
    let aiIssues: Awaited<ReturnType<typeof generateCvQualityFeedback>> = [];
    let aiAvailable = true;
    try {
      aiIssues = await generateCvQualityFeedback(row.masked_text);
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
    // A paid analysis credit includes the full interview. The first account credit
    // therefore gives new users one complete, testable workflow.
    const premiumUnlocked = true;
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
        is_premium_unlocked: premiumUnlocked,
        requirements: analysis.requirements,
        scoring_breakdown: analysis.scoring_breakdown
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

router.get("/analyses", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { data, error } = await supabase.from("analyses")
      .select("id,cv_id,jd_text,rci_score,created_at")
      .eq("user_id", userId(req)).order("created_at", { ascending: false }).limit(20);
    if (error) throw error;
    res.json({ analyses: data });
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

const interviewQuestionsSchema = z.array(z.string().trim().min(10).max(1000)).length(3);

async function getInterview(sessionId: string, ownerId: string) {
  const parsed = z.string().uuid().safeParse(sessionId);
  if (!parsed.success) throw new HttpError(400, "Invalid interview session ID");
  const { data, error } = await supabase.from("interview_sessions").select("*")
    .eq("id", parsed.data).eq("user_id", ownerId).maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, "Interview session not found");
  return { ...data, questions: interviewQuestionsSchema.parse(data.questions) };
}

router.post("/interviews", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const body = parseBody(z.object({ analysis_id: z.string().uuid() }), req.body);
    const ownerId = userId(req);
    const { data: analysis, error } = await supabase.from("analyses")
      .select("id,cv_id,jd_text,layer_4_mock").eq("id", body.analysis_id)
      .eq("user_id", ownerId).maybeSingle();
    if (error) throw error;
    if (!analysis) throw new HttpError(404, "Analysis not found");
    const parsed = interviewQuestionsSchema.safeParse(analysis.layer_4_mock);
    if (!parsed.success) throw new HttpError(402, "Unlock interview questions before starting practice");
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

router.get("/interviews", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { data, error } = await supabase.from("interview_sessions")
      .select("id,analysis_id,status,created_at,completed_at")
      .eq("user_id", userId(req)).order("created_at", { ascending: false }).limit(20);
    if (error) throw error;
    res.json({ sessions: data });
  } catch (error) {
    sendError(res, error);
  }
});

router.get("/interviews/:sessionId", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const session = await getInterview(req.params.sessionId, userId(req));
    const { data: answers, error } = await supabase.from("interview_answers")
      .select("question_index,answer_text,evaluation,created_at")
      .eq("session_id", session.id).order("question_index", { ascending: true });
    if (error) throw error;
    const overall_score = answers.length === session.questions.length
      ? Math.round(answers.reduce((sum, answer) => sum + Number(answer.evaluation.score || 0), 0) / answers.length)
      : null;
    res.json({ session: { id: session.id, analysis_id: session.analysis_id,
      questions: session.questions, status: session.status, created_at: session.created_at,
      answers, overall_score } });
  } catch (error) {
    sendError(res, error);
  }
});

router.get("/interviews/:sessionId/questions/:index/audio", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const session = await getInterview(req.params.sessionId, userId(req));
    const index = z.coerce.number().int().min(0).max(2).safeParse(req.params.index);
    if (!index.success) throw new HttpError(400, "Invalid question index");
    const audio = await synthesizeQuestion(session.questions[index.data]);
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
      question_index: z.number().int().min(0).max(2),
      answer_text: z.string().trim().min(20).max(5000)
    }), req.body);
    const ownerId = userId(req);
    const session = await getInterview(req.params.sessionId, ownerId);
    if (session.status === "COMPLETED") throw new HttpError(409, "Interview is already completed");
    const { data: cv, error: cvError } = await supabase.from("cv_documents")
      .select("masked_text").eq("id", session.cv_id).eq("user_id", ownerId).maybeSingle();
    if (cvError) throw cvError;
    if (!cv) throw new HttpError(404, "CV not found");
    const evaluation = await evaluateInterviewAnswer({ question: session.questions[body.question_index],
      answer: body.answer_text, cvText: cv.masked_text, jdText: session.jd_text });
    const { error: saveError } = await supabase.from("interview_answers").upsert({
      session_id: session.id, question_index: body.question_index,
      answer_text: body.answer_text, evaluation
    }, { onConflict: "session_id,question_index" });
    if (saveError) throw saveError;
    const { data: answers, error: countError } = await supabase.from("interview_answers")
      .select("evaluation").eq("session_id", session.id);
    if (countError) throw countError;
    const completed = answers.length === session.questions.length;
    if (completed) {
      const { error: completeError } = await supabase.from("interview_sessions")
        .update({ status: "COMPLETED", completed_at: new Date().toISOString() })
        .eq("id", session.id).eq("user_id", ownerId);
      if (completeError) throw completeError;
    }
    const overall_score = completed
      ? Math.round(answers.reduce((sum, item) => sum + Number(item.evaluation.score || 0), 0) / answers.length)
      : null;
    res.json({ evaluation, completed, overall_score });
  } catch (error) {
    sendError(res, error);
  }
});

export const apiRouter = router;
