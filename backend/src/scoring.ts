export const SCORING_WEIGHTS = {
  skills: 45,
  experience: 35,
  education: 20
} as const;

export type RequirementCategory = keyof typeof SCORING_WEIGHTS;
export type GroundedRequirement = {
  category: RequirementCategory;
  jd_quote: string;
  cv_quote: string | null;
};

export type ScoredRequirement = GroundedRequirement & { matched: boolean };
export type ScoringBreakdown = {
  category: RequirementCategory;
  weight: number;
  matched: number;
  total: number;
  score: number;
}[];

export function normalizeEvidence(value: string): string {
  return value.normalize("NFC").replace(/\s+/gu, " ").trim().toLocaleLowerCase("vi-VN");
}

export function isGroundedQuote(source: string, quote: string): boolean {
  const normalized = normalizeEvidence(quote);
  return normalized.length >= 5 && normalizeEvidence(source).includes(normalized);
}

export function assertStructuredCvGrounded(source: string, values: string[]): void {
  const normalizedSource = normalizeEvidence(source);
  const sourceNumbers = new Set(source.match(/\d+(?:[.,]\d+)?%?/gu) ?? []);
  for (const value of values) {
    const item = value.trim();
    if (!item) continue;
    const numbers = item.match(/\d+(?:[.,]\d+)?%?/gu) ?? [];
    if (numbers.some((number) => !sourceNumbers.has(number))) {
      throw new Error("AI extracted a number absent from the CV");
    }
    if (item.length >= 2 && !normalizedSource.includes(normalizeEvidence(item))) {
      throw new Error("AI extracted CV information without source evidence");
    }
  }
}

/** What the AI returns before any of it is checked against the documents. */
export type RawRequirement = { category: string; jd_quote: string; cv_quote: string | null };

const MAX_REQUIREMENTS = 20;
const MAX_QUOTE_LENGTH = 400;
const CATEGORIES = Object.keys(SCORING_WEIGHTS) as RequirementCategory[];

function isCategory(value: string): value is RequirementCategory {
  return (CATEGORIES as string[]).includes(value);
}

/**
 * Drops requirements the JD does not state word for word and counts a CV quote that cannot be
 * found in the CV as unmet. A mistake by the AI can therefore lower the score but never raise it,
 * and one bad quote no longer throws the whole analysis away.
 */
export function groundRequirements(requirements: RawRequirement[], cvText: string, jdText: string) {
  const grounded: ScoredRequirement[] = [];
  const byQuote = new Map<string, ScoredRequirement>();
  let unverified = 0;
  for (const item of requirements) {
    const jdQuote = item.jd_quote.trim();
    if (!isCategory(item.category) || jdQuote.length > MAX_QUOTE_LENGTH || !isGroundedQuote(jdText, jdQuote)) continue;
    const cvQuote = item.cv_quote?.trim() ?? "";
    const matched = cvQuote.length <= MAX_QUOTE_LENGTH && isGroundedQuote(cvText, cvQuote);
    if (cvQuote && !matched) unverified += 1;
    const key = normalizeEvidence(jdQuote);
    const existing = byQuote.get(key);
    if (existing) {
      // The same JD line listed twice counts once, as met if either copy carried CV evidence.
      if (matched && !existing.matched) Object.assign(existing, { cv_quote: cvQuote, matched: true });
      continue;
    }
    if (grounded.length === MAX_REQUIREMENTS) continue;
    const requirement = { category: item.category, jd_quote: jdQuote, cv_quote: matched ? cvQuote : null, matched };
    byQuote.set(key, requirement);
    grounded.push(requirement);
  }
  return { requirements: grounded, dropped: requirements.length - grounded.length, unverified };
}

/** Keeps project feedback only for projects named in the CV and backed by a CV quote. */
export function groundProjects<T extends { project_name: string; evidence: string }>(projects: T[], cvText: string): T[] {
  const source = normalizeEvidence(cvText);
  return projects.filter((item) => {
    const name = normalizeEvidence(item.project_name);
    return name.length >= 2 && source.includes(name) && isGroundedQuote(cvText, item.evidence);
  });
}

export function groundEvidence<T extends { quote: string }>(items: T[], source: string): T[] {
  return items.filter((item) => isGroundedQuote(source, item.quote));
}

type InterviewFeedbackShape = {
  strengths: { claim: string; quote: string }[];
  improvements: { finding: string; suggestion: string; answer_quote: string | null }[];
};

/** A strength needs a real quote from the answer; an improvement may stand without one. */
export function groundInterviewFeedback<T extends InterviewFeedbackShape>(feedback: T, answer: string): T {
  return {
    ...feedback,
    strengths: groundEvidence(feedback.strengths, answer),
    improvements: feedback.improvements.map((item) =>
      item.answer_quote !== null && !isGroundedQuote(answer, item.answer_quote) ? { ...item, answer_quote: null } : item)
  };
}

export function scoreRequirements(
  requirements: RawRequirement[],
  cvText: string,
  jdText: string
): { score: number; breakdown: ScoringBreakdown; requirements: ScoredRequirement[]; dropped: number; unverified: number } {
  const { requirements: grounded, dropped, unverified } = groundRequirements(requirements, cvText, jdText);
  if (!grounded.length) throw new Error("No JD requirement could be verified against the JD text");
  const active = CATEGORIES.filter((category) => grounded.some((item) => item.category === category));
  const activeWeight = active.reduce((sum, category) => sum + SCORING_WEIGHTS[category], 0);
  const breakdown = active.map((category) => {
    const categoryItems = grounded.filter((item) => item.category === category);
    const matched = categoryItems.filter((item) => item.matched).length;
    return {
      category,
      weight: SCORING_WEIGHTS[category],
      matched,
      total: categoryItems.length,
      score: Math.round(100 * matched / categoryItems.length)
    };
  });
  const score = Math.round(grounded.reduce((sum, item) =>
    sum + (item.matched ? SCORING_WEIGHTS[item.category] /
      grounded.filter((other) => other.category === item.category).length : 0), 0) * 100 / activeWeight);
  return { score, breakdown, requirements: grounded, dropped, unverified };
}

export function assertSourceBoundRewrite(source: string, statements: { text: string; source_quote: string }[]): string {
  if (!statements.length || statements.length > 6) throw new Error("AI rewrite must contain 1 to 6 statements");
  const sourceNumbers = new Set(source.match(/\d+(?:[.,]\d+)?%?/gu) ?? []);
  const lines = statements.map(({ text, source_quote }) => {
    if (!isGroundedQuote(source, source_quote)) throw new Error("AI rewrite lacks source evidence");
    const numbers = text.match(/\d+(?:[.,]\d+)?%?/gu) ?? [];
    if (numbers.some((number) => !sourceNumbers.has(number))) {
      throw new Error("AI rewrite introduced a number absent from the CV section");
    }
    const cleaned = text.trim().replace(/^-\s*/, "");
    if (!cleaned || cleaned.length > 600) throw new Error("AI rewrite statement is invalid");
    const tokens = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/gu, "")
      .toLowerCase().match(/[a-z0-9+#.]{3,}/gu) ?? [];
    const stopWords = new Set(["cho", "voi", "trong", "cua", "cac", "mot", "nhung", "duoc",
      "theo", "tai", "toi", "thi", "day", "and", "the", "for", "with"]);
    const claimTokens = [...new Set(tokens(cleaned).filter((word) => !stopWords.has(word)))];
    const quoteTokens = new Set(tokens(source_quote));
    const supported = claimTokens.filter((word) => quoteTokens.has(word)).length;
    if (claimTokens.length && supported / claimTokens.length < 0.4) {
      throw new Error("AI rewrite is not sufficiently supported by its CV quote");
    }
    const namedTerms = [...cleaned.matchAll(/\b[A-Z][A-Za-z0-9.+#-]{2,}\b/gu)];
    if (namedTerms.some((match) => match.index !== 0 && !source.toLowerCase().includes(match[0].toLowerCase()))) {
      throw new Error("AI rewrite introduced an unsupported named term");
    }
    return `- ${cleaned}`;
  });
  return lines.join("\n");
}
