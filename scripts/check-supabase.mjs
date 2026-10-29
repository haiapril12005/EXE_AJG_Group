import { readFile } from "node:fs/promises";

const envPath = new URL("../frontend/.env.local", import.meta.url);
const entries = (await readFile(envPath, "utf8"))
  .split(/\r?\n/)
  .filter((line) => line && !line.trimStart().startsWith("#"))
  .map((line) => {
    const separator = line.indexOf("=");
    return [line.slice(0, separator), line.slice(separator + 1)];
  });
const env = Object.fromEntries(entries);
const projectUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!projectUrl || !publishableKey) {
  console.error("Missing Supabase URL or publishable key in frontend/.env.local");
  process.exit(1);
}

const headers = {
  apikey: publishableKey,
  Authorization: `Bearer ${publishableKey}`
};
let failed = false;

try {
  const auth = await fetch(`${projectUrl}/auth/v1/health`, { headers });
  console.log(`${auth.ok ? "PASS" : "FAIL"} Supabase Auth reachable (HTTP ${auth.status})`);
  if (!auth.ok) failed = true;

  const tables = [
    ["users", "id"], ["cv_documents", "cv_data"],
    ["analyses", "requirements,scoring_breakdown"], ["transactions", "id"],
    ["cv_evaluations", "id"], ["interview_sessions", "id"],
    ["interview_answers", "session_id"]
  ];
  for (const [table, columns] of tables) {
    const response = await fetch(`${projectUrl}/rest/v1/${table}?select=${columns}&limit=0`, { headers });
    if (response.ok) {
      console.log(`PASS public.${table} is available`);
    } else {
      const body = await response.json().catch(() => ({}));
      if (body.code === "PGRST205") {
        console.error(`FAIL public.${table} is missing; apply all Supabase SQL migrations first`);
      } else {
        console.error(`FAIL public.${table} returned HTTP ${response.status}: ${body.message ?? "unknown error"}`);
      }
      failed = true;
    }
  }
} catch (error) {
  console.error(`FAIL Supabase connection: ${error instanceof Error ? error.message : "network error"}`);
  failed = true;
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("Supabase connection and schema checks passed.");
}
