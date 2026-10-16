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
  PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  SUPABASE_URL: z.string().url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1).optional(),
  SUPABASE_ANON_KEY: z.string().min(1).optional(),
  SUPABASE_SECRET_KEY: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  SUPABASE_JWKS_URL: z.string().url().optional(),
  GEMINI_API_KEY: optionalEnvString,
  GEMINI_MODEL: z.string().default("gemini-3.6-flash"),
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
  throw new Error("Set SUPABASE_PUBLISHABLE_KEY in api/.env.");
}
if (!secretKey) {
  throw new Error("Set SUPABASE_SECRET_KEY in api/.env. Keep this key private.");
}

export const config = {
  ...parsedConfig,
  SUPABASE_PUBLISHABLE_KEY: publishableKey,
  SUPABASE_SECRET_KEY: secretKey,
  SUPABASE_JWKS_URL:
    parsedConfig.SUPABASE_JWKS_URL ??
    `${parsedConfig.SUPABASE_URL.replace(/\/$/, "")}/auth/v1/.well-known/jwks.json`
};
