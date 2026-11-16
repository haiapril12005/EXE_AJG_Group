import "dotenv/config";
import { z } from "zod";

const optionalEnvString = z.preprocess(
  (value) => value === "" ? undefined : value,
  z.string().min(1).optional()
);
const optionalEnvUrl = z.preprocess(
  (value) => value === "" ? undefined : value,
  z.string().url().optional()
);

const environmentSchema = z.object({
  // One port serves both the website and /api.
  PORT: z.coerce.number().int().positive().default(3000),
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  // Reverse proxies between the user and the API (1 on Render); 0 when the API is reached directly.
  TRUST_PROXY: z.preprocess(
    (value) => value === "" ? undefined : value,
    z.coerce.number().int().min(0).max(10).default(0)
  ),
  SUPABASE_URL: z.string().url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1).optional(),
  SUPABASE_ANON_KEY: z.string().min(1).optional(),
  SUPABASE_SECRET_KEY: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  SUPABASE_JWKS_URL: z.string().url().optional(),
  GEMINI_API_KEY: optionalEnvString,
  GEMINI_MODEL: z.string().default("gemini-3.6-flash"),
  GEMINI_STT_MODEL: z.string().default("gemini-3.5-transcribe"),
  GEMINI_TTS_MODEL: z.string().default("gemini-3.8-flash-lite-tts"),
  GEMINI_TTS_VOICE: z.string().default("Kore"),
  // AI cost estimate on the admin page: USD per 1 million tokens (thinking tokens bill as output).
  AI_PRICE_INPUT_USD_PER_M: z.preprocess((value) => value === "" ? undefined : value, z.coerce.number().min(0).default(0.5)),
  AI_PRICE_OUTPUT_USD_PER_M: z.preprocess((value) => value === "" ? undefined : value, z.coerce.number().min(0).default(3)),
  USD_VND_RATE: z.preprocess((value) => value === "" ? undefined : value, z.coerce.number().positive().default(26000)),
  // 0 turns automatic job sync off; `npm run jobs:sync` still works.
  JOB_SYNC_INTERVAL_HOURS: z.preprocess(
    (value) => value === "" ? undefined : value,
    z.coerce.number().min(0).max(168).default(12)
  ),
  PAYOS_CLIENT_ID: optionalEnvString,
  PAYOS_API_KEY: optionalEnvString,
  PAYOS_CHECKSUM_KEY: optionalEnvString,
  PAYOS_RETURN_URL: optionalEnvUrl,
  PAYOS_CANCEL_URL: optionalEnvUrl
});

const parsedConfig = environmentSchema.parse(process.env);
const publishableKey = parsedConfig.SUPABASE_PUBLISHABLE_KEY ?? parsedConfig.SUPABASE_ANON_KEY;
const secretKey = parsedConfig.SUPABASE_SECRET_KEY ?? parsedConfig.SUPABASE_SERVICE_ROLE_KEY;

if (!publishableKey) {
  throw new Error("Set SUPABASE_PUBLISHABLE_KEY in backend/.env.");
}
if (!secretKey) {
  throw new Error("Set SUPABASE_SECRET_KEY in backend/.env. Keep this key private.");
}

export const config = {
  ...parsedConfig,
  SUPABASE_PUBLISHABLE_KEY: publishableKey,
  SUPABASE_SECRET_KEY: secretKey,
  SUPABASE_JWKS_URL:
    parsedConfig.SUPABASE_JWKS_URL ??
    `${parsedConfig.SUPABASE_URL.replace(/\/$/, "")}/auth/v1/.well-known/jwks.json`
};
