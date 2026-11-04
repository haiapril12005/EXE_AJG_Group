import { config } from "../config";
import { supabase } from "../supabase";
import { isSyncDue } from "./normalize";
import { syncJobs } from "./sync";

const HOUR_MS = 3_600_000;

/**
 * Keeps the job catalog fresh while the API runs. The decision uses the newest `last_seen_at`
 * in the database, so restarting the dev server does not trigger another scan.
 */
export function startJobSyncSchedule(): void {
  const hours = config.JOB_SYNC_INTERVAL_HOURS;
  if (!hours) {
    console.log("Automatic job sync is off (JOB_SYNC_INTERVAL_HOURS=0)");
    return;
  }
  const intervalMs = hours * HOUR_MS;
  let running = false;

  const syncIfDue = async () => {
    if (running) return;
    running = true;
    try {
      const { data, error } = await supabase.from("job_postings").select("last_seen_at")
        .order("last_seen_at", { ascending: false }).limit(1).maybeSingle();
      if (error) {
        console.warn(error.code === "PGRST205"
          ? "Automatic job sync skipped: run supabase/migrations/004_job_postings.sql first."
          : `Automatic job sync skipped: ${error.message}`);
        return;
      }
      if (!isSyncDue(data?.last_seen_at ?? null, Date.now(), intervalMs)) return;
      console.log("Automatic job sync started");
      const healthy = await syncJobs({ dryRun: false });
      console.log(`Automatic job sync finished${healthy ? "" : " with errors in some sources"}`);
    } catch (error) {
      console.error("Automatic job sync failed", error instanceof Error ? error.message : error);
    } finally {
      running = false;
    }
  };

  void syncIfDue();
  // Checking at least hourly catches up soon after the computer wakes from sleep.
  setInterval(() => void syncIfDue(), Math.min(intervalMs, HOUR_MS)).unref();
}
