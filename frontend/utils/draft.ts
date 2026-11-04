export type DraftJob = { id: string; title: string; company: string };
export type JdDraft = { text: string; job: DraftJob | null };

const DRAFT_KEY = "cvfit.jd-draft";

/** Keeps the JD while the user moves between pages; losing it must not block the form. */
export function loadDraft(): JdDraft {
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(DRAFT_KEY) ?? "null") as Partial<JdDraft> | null;
    return { text: typeof saved?.text === "string" ? saved.text : "", job: saved?.job ?? null };
  } catch {
    return { text: "", job: null };
  }
}

export function saveDraft(draft: JdDraft) {
  try {
    window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Storage can be blocked; the page state still holds the JD.
  }
}
