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

export function scoreRequirements(
  requirements: GroundedRequirement[],
  cvText: string,
  jdText: string
): { score: number; breakdown: ScoringBreakdown; requirements: ScoredRequirement[] } {
  if (requirements.length < 1 || requirements.length > 20) {
    throw new Error("Analysis must include 1 to 20 JD requirements");
  }
  const seen = new Set<string>();
  const grounded = requirements.map((item) => {
    if (!(item.category in SCORING_WEIGHTS) || !isGroundedQuote(jdText, item.jd_quote)) {
      throw new Error("AI returned a JD requirement without a valid JD quote");
    }
    const key = normalizeEvidence(item.jd_quote);
    if (seen.has(key)) throw new Error("AI returned a duplicate JD requirement");
    seen.add(key);
    if (item.cv_quote !== null && !isGroundedQuote(cvText, item.cv_quote)) {
      throw new Error("AI returned a CV match without a valid CV quote");
    }
    return { ...item, matched: item.cv_quote !== null };
  });
  const active = (Object.keys(SCORING_WEIGHTS) as RequirementCategory[])
    .filter((category) => grounded.some((item) => item.category === category));
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
  return { score, breakdown, requirements: grounded };
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
