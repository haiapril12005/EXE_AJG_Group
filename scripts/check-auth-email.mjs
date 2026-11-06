import dotenv from "dotenv";

dotenv.config({ path: new URL("../backend/.env", import.meta.url) });
const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  console.error("Configure Supabase URL and publishable key in backend/.env first.");
  process.exit(1);
}

try {
  const response = await fetch(`${SUPABASE_URL.replace(/\/$/, "")}/auth/v1/settings`, {
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY }
  });
  if (!response.ok) throw new Error(`Supabase Auth settings returned HTTP ${response.status}`);
  const settings = await response.json();
  const checks = [
    ["Email sign-in enabled", settings.external?.email === true],
    ["New registrations enabled", settings.disable_signup === false],
    ["Email confirmation required", settings.mailer_autoconfirm === false]
  ];
  for (const [label, valid] of checks) console.log(`${valid ? "PASS" : "FAIL"} ${label}`);
  console.log("SMTP credentials and email templates are private settings; inspect them in Supabase Dashboard.");
  if (checks.some(([, valid]) => !valid)) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : "Could not inspect Supabase Auth settings");
  process.exitCode = 1;
}
