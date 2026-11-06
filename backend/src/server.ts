import path from "node:path";
import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import next from "next";
import { config } from "./config";
import { HttpError } from "./errors";
import { startJobSyncSchedule } from "./jobs/schedule";
import { apiRouter } from "./routes";
import { supabase } from "./supabase";

const app = express();
// Behind a hosting proxy every request comes from the proxy's address, so the rate limit
// below would be shared by all users unless Express reads the client IP the proxy forwards.
app.set("trust proxy", config.TRUST_PROXY);
// API and website share one port: /api and /health are answered here, everything else is the
// Next.js frontend below. Helmet's default CSP would block the inline scripts Next.js pages need,
// so it covers only the API.
const API_PATHS = ["/api", "/health"];
app.use(API_PATHS, helmet());
app.use("/api", cors({
  origin(origin, callback) {
    if (!origin || origin === config.WEB_ORIGIN) {
      callback(null, true);
      return;
    }

    if (process.env.NODE_ENV !== "production") {
      try {
        const parsedOrigin = new URL(origin);
        const isLocalHttpOrigin = parsedOrigin.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(parsedOrigin.hostname);
        callback(null, isLocalHttpOrigin);
        return;
      } catch {
        callback(null, false);
        return;
      }
    }

    callback(null, false);
  }
}));
app.use("/api", express.json({ limit: "1mb" }));
app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.get("/health/ready", async (_req, res) => {
  const { error } = await supabase.from("interview_sessions").select("id").limit(1);
  if (error) {
    console.error("Database readiness check failed", error);
    res.status(503).json({
      status: "not_ready",
      database: error.code === "PGRST205" ? "schema_not_applied" : "unavailable",
      message: error.code === "PGRST205"
        ? "Apply all files in supabase/migrations in order."
        : "Check the Supabase URL and API credentials in backend/.env."
    });
    return;
  }
  res.json({ status: "ready", database: "connected" });
});
app.use("/api", rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: "draft-7", legacyHeaders: false }));
app.use("/api", apiRouter);
app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  if (
    error instanceof Error &&
    (error.name === "MulterError" || error.message.includes("Only PDF files are allowed") ||
      error.message.includes("Only audio recordings are allowed"))
  ) {
    res.status(400).json({ error: error.message });
    return;
  }
  console.error("Unhandled API error", error);
  res.status(500).json({ error: "An unexpected server error occurred" });
};
app.use(API_PATHS, errorHandler);

// backend/src (tsx) and backend/dist (built) both sit two levels below the repository root.
const web = next({ dev: process.env.NODE_ENV !== "production", dir: path.join(__dirname, "../../frontend") });
const handleWeb = web.getRequestHandler();
app.all("*", (req, res) => handleWeb(req, res));

web.prepare().then(() => {
  app.listen(config.PORT, () => {
    console.log(`Job Ready listening on http://localhost:${config.PORT}`);
    startJobSyncSchedule();
  });
}).catch((error: unknown) => {
  console.error("Could not start the Next.js frontend", error);
  process.exit(1);
});
