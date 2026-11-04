import { syncJobs } from "./sync";

void syncJobs({ dryRun: process.argv.includes("--dry-run") }).then((healthy) => {
  if (!healthy) process.exitCode = 1;
});
