import { supabase } from "../supabase";
import { categorizeJob } from "./categories";
import { fetchJobSource, JOB_SOURCES, type JobSource } from "./connectors";
import { planMissedScans } from "./normalize";

async function storeSource(source: JobSource, jobs: Awaited<ReturnType<typeof fetchJobSource>>) {
  const seenAt = new Date().toISOString();
  if (jobs.jobs.length) {
    const { error } = await supabase.from("job_postings").upsert(
      jobs.jobs.map((job) => ({ ...job, category: categorizeJob(job.title), last_seen_at: seenAt, missed_scans: 0, is_active: true })),
      { onConflict: "source,source_key,external_id" }
    );
    if (error) throw error;
  }

  const { data: active, error: activeError } = await supabase.from("job_postings")
    .select("id,external_id,missed_scans")
    .eq("source", source.type).eq("source_key", source.key).eq("is_active", true);
  if (activeError) throw activeError;

  const stored = new Set(jobs.jobs.map((job) => job.external_id));
  const stillListed = active.filter((row) => !stored.has(row.external_id) && jobs.seenIds.includes(row.external_id));
  if (stillListed.length) {
    const { error } = await supabase.from("job_postings").update({ last_seen_at: seenAt, missed_scans: 0 })
      .in("id", stillListed.map((row) => row.id));
    if (error) throw error;
  }

  const { strike, hide } = planMissedScans(active, new Set(jobs.seenIds));
  if (strike.length) {
    const { error } = await supabase.from("job_postings").update({ missed_scans: 1 }).in("id", strike.map((row) => row.id));
    if (error) throw error;
  }
  if (hide.length) {
    const { error } = await supabase.from("job_postings").update({ missed_scans: 2, is_active: false }).in("id", hide.map((row) => row.id));
    if (error) throw error;
  }
  return { missed: strike.length, hidden: hide.length };
}

// Supabase errors are plain objects, so `instanceof Error` alone would print "[object Object]".
function describeSyncError(error: unknown): string {
  const { code, message } = (error ?? {}) as { code?: string; message?: string };
  // 23514: the source check constraint predates this source type.
  if (code === "23514") return "the database does not accept this source yet; run supabase/migrations/006_job_sources_lever_ashby.sql";
  // PGRST204: the category column is not in the database yet.
  if (code === "PGRST204" && /category/.test(message ?? "")) return "the database has no job category column yet; run supabase/migrations/010_job_categories.sql";
  return message ?? String(error);
}

export async function syncJobs({ dryRun }: { dryRun: boolean }): Promise<boolean> {
  let healthy = true;
  for (const source of JOB_SOURCES) {
    const label = `${source.type}/${source.key}`;
    try {
      const result = await fetchJobSource(source);
      if (dryRun) {
        console.log(`${label}: ${result.jobs.length} usable, ${result.skipped} skipped`);
        continue;
      }
      const { missed, hidden } = await storeSource(source, result);
      console.log(`${label}: ${result.jobs.length} stored, ${result.skipped} skipped, ${missed} missing, ${hidden} hidden`);
    } catch (error) {
      healthy = false;
      console.error(`${label}: failed`, describeSyncError(error));
    }
  }
  return healthy;
}
