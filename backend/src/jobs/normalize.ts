import { maskText } from "../cvData";

// The longest JD /analyze accepts; quotes are checked against exactly this text.
export const JD_MAX_LENGTH = 20_000;
const JD_MIN_LENGTH = 50;

export type JobSourceType = "greenhouse" | "smartrecruiters";

export type NormalizedJob = {
  source: JobSourceType;
  source_key: string;
  external_id: string;
  company: string;
  title: string;
  location: string;
  city: string;
  description: string;
  url: string;
  posted_at: string | null;
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] !== "#") return ENTITIES[entity.toLowerCase()] ?? match;
    const hex = entity[1].toLowerCase() === "x";
    const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}

export function htmlToText(html: string): string {
  // Greenhouse escapes its HTML, so the tags only appear after one decode.
  const markup = /&lt;\/?[a-z]/i.test(html) ? decodeEntities(html) : html;
  const text = markup
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|ul|ol|li|h[1-6]|tr|section)\s*>/gi, "\n")
    .replace(/<[^>]*>/g, " ");
  return decodeEntities(text)
    // Strip null bytes () — PostgreSQL text fields reject them
    .replace(/\u0000/g, "")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

const plain = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();

export function isVietnamLocation(location: string): boolean {
  return /viet ?nam|ho chi minh|hcmc|sai ?gon|ha ?noi|da ?nang/.test(plain(location));
}

export function cityOf(location: string): string {
  const value = plain(location);
  if (/ho chi minh|hcmc|sai ?gon/.test(value)) return "Hồ Chí Minh";
  if (/ha ?noi/.test(value)) return "Hà Nội";
  if (/da ?nang/.test(value)) return "Đà Nẵng";
  return "Việt Nam";
}

/** Returns null for postings the app cannot analyze or safely link to. */
export function normalizeJob(input: Omit<NormalizedJob, "city" | "description"> & { html: string }): NormalizedJob | null {
  const { html, ...job } = input;
  const description = maskText(htmlToText(html)).slice(0, JD_MAX_LENGTH).trim();
  if (description.length < JD_MIN_LENGTH || !job.title.trim() || !/^https?:\/\//i.test(job.url)) return null;
  return { ...job, title: job.title.trim(), city: cityOf(job.location), description };
}

/** The catalog is due for a scan when it is empty or its newest sighting is older than the interval. */
export function isSyncDue(lastSeenAt: string | null, now: number, intervalMs: number): boolean {
  if (!lastSeenAt) return true;
  const seenAt = Date.parse(lastSeenAt);
  return Number.isNaN(seenAt) || now - seenAt >= intervalMs;
}

/**
 * Postings missing from this scan count one strike; two in a row hide them.
 * A failed source never reaches this function, so an outage hides nothing.
 */
export function planMissedScans<T extends { external_id: string; missed_scans: number }>(active: T[], seenIds: Set<string>) {
  const missed = active.filter((item) => !seenIds.has(item.external_id));
  return {
    strike: missed.filter((item) => item.missed_scans < 1),
    hide: missed.filter((item) => item.missed_scans >= 1)
  };
}
