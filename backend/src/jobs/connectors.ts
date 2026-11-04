import { HttpError } from "../errors";
import { isVietnamLocation, normalizeJob, type JobSourceType, type NormalizedJob } from "./normalize";

export type JobSource = { type: JobSourceType; key: string; company: string };

// Add a company here after checking that it has postings in Vietnam.
export const JOB_SOURCES: JobSource[] = [
  { type: "smartrecruiters", key: "BoschGroup", company: "Bosch" },
  { type: "smartrecruiters", key: "Grab", company: "Grab" },
  { type: "smartrecruiters", key: "Endava", company: "Endava" },
  { type: "smartrecruiters", key: "NielsenIQ", company: "NielsenIQ" },
  { type: "smartrecruiters", key: "Ubisoft2", company: "Ubisoft" },
  { type: "greenhouse", key: "axon", company: "Axon" },
  { type: "greenhouse", key: "binance", company: "Binance" },
  { type: "greenhouse", key: "thoughtworks", company: "Thoughtworks" },
  { type: "greenhouse", key: "agoda", company: "Agoda" }
];

/** `seenIds` also lists postings whose details failed, so they are not treated as removed. */
export type ConnectorResult = { jobs: NormalizedJob[]; seenIds: string[]; skipped: number };

const USER_AGENT = "JobReady-JobSync/1.0";
const SMARTRECRUITERS_PAGE_SIZE = 100;
const SMARTRECRUITERS_DELAY_MS = 150;

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) throw new HttpError(502, `${url} returned HTTP ${response.status}`);
  return await response.json() as T;
}

type GreenhouseJob = {
  id: number;
  title: string;
  content?: string;
  absolute_url: string;
  first_published?: string | null;
  updated_at?: string | null;
  location?: { name?: string };
};

export function mapGreenhouseJobs(source: JobSource, jobs: GreenhouseJob[]): ConnectorResult {
  const inVietnam = jobs.filter((job) => isVietnamLocation(job.location?.name ?? ""));
  const mapped = inVietnam.map((job) => normalizeJob({
    source: "greenhouse",
    source_key: source.key,
    external_id: String(job.id),
    company: source.company,
    title: job.title,
    location: job.location?.name ?? "",
    url: job.absolute_url,
    posted_at: job.first_published ?? job.updated_at ?? null,
    html: job.content ?? ""
  }));
  const usable = mapped.filter((job) => job !== null);
  return { jobs: usable, seenIds: inVietnam.map((job) => String(job.id)), skipped: mapped.length - usable.length };
}

async function fetchGreenhouse(source: JobSource): Promise<ConnectorResult> {
  const board = encodeURIComponent(source.key);
  const { jobs } = await getJson<{ jobs: GreenhouseJob[] }>(
    `https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`
  );
  return mapGreenhouseJobs(source, jobs);
}

type SmartRecruitersSummary = { id: string };
type SmartRecruitersDetail = {
  id: string;
  name: string;
  postingUrl?: string;
  releasedDate?: string | null;
  location?: { fullLocation?: string; city?: string };
  jobAd?: { sections?: Record<string, { title?: string; text?: string } | undefined> };
};

export function mapSmartRecruitersJob(source: JobSource, detail: SmartRecruitersDetail): NormalizedJob | null {
  const sections = detail.jobAd?.sections ?? {};
  const html = [sections.jobDescription, sections.qualifications, sections.additionalInformation]
    .filter((section) => section?.text)
    .map((section) => `<h3>${section?.title ?? ""}</h3>${section?.text}`)
    .join("\n");
  return normalizeJob({
    source: "smartrecruiters",
    source_key: source.key,
    external_id: detail.id,
    company: source.company,
    title: detail.name,
    // fullLocation leaves a blank region in the middle: "Ho Chi Minh City, , Vietnam".
    location: (detail.location?.fullLocation ?? detail.location?.city ?? "").replace(/(,\s*)+,/g, ","),
    url: detail.postingUrl ?? "",
    posted_at: detail.releasedDate ?? null,
    html
  });
}

async function fetchSmartRecruiters(source: JobSource): Promise<ConnectorResult> {
  const base = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(source.key)}/postings`;
  const listed: string[] = [];
  for (let offset = 0; ; offset += SMARTRECRUITERS_PAGE_SIZE) {
    const page = await getJson<{ totalFound: number; content: SmartRecruitersSummary[] }>(
      `${base}?country=vn&limit=${SMARTRECRUITERS_PAGE_SIZE}&offset=${offset}`
    );
    listed.push(...page.content.map((item) => item.id));
    if (!page.content.length || listed.length >= page.totalFound) break;
  }
  const ids = [...new Set(listed)];

  const jobs: NormalizedJob[] = [];
  let skipped = 0;
  for (const id of ids) {
    try {
      const job = mapSmartRecruitersJob(source, await getJson<SmartRecruitersDetail>(`${base}/${encodeURIComponent(id)}`));
      if (job) jobs.push(job);
      else skipped += 1;
    } catch (error) {
      skipped += 1;
      console.error(`Skipped ${source.key} posting ${id}`, error instanceof Error ? error.message : error);
    }
    await new Promise((resolve) => setTimeout(resolve, SMARTRECRUITERS_DELAY_MS));
  }
  return { jobs, seenIds: ids, skipped };
}

export function fetchJobSource(source: JobSource): Promise<ConnectorResult> {
  return source.type === "greenhouse" ? fetchGreenhouse(source) : fetchSmartRecruiters(source);
}
