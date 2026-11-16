import assert from "node:assert/strict";
import test from "node:test";
import { buildAdminOverview, deriveUserCode, MAX_ADMINS, readAllPages, searchWords, userCodeOf, validateAdminGrantCandidate } from "../src/admin";

test("rejects invalid email or unregistered user when granting admin", () => {
  const invalid = validateAdminGrantCandidate("not-an-email", null, 0);
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.code, "INVALID_EMAIL");

  const missing = validateAdminGrantCandidate("unknown@example.com", null, 0);
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.code, "USER_NOT_FOUND");
});

test("rejects granting admin to an account whose email is not confirmed via OTP", () => {
  const unconfirmed = validateAdminGrantCandidate("user@example.com", {
    id: "00000000-0000-4000-8000-000000000001",
    email: "user@example.com",
    full_name: "Unconfirmed User",
    is_admin: false,
    email_confirmed_at: null
  }, 1);

  assert.equal(unconfirmed.ok, false);
  if (!unconfirmed.ok) assert.equal(unconfirmed.code, "EMAIL_NOT_CONFIRMED");
});

test("enforces the hard cap of MAX_ADMINS while allowing idempotent re-check of an existing admin", () => {
  const candidate = {
    id: "00000000-0000-4000-8000-000000000002",
    email: "candidate@example.com",
    full_name: "Verified Candidate",
    is_admin: false,
    email_confirmed_at: "2026-10-01T00:00:00.000Z"
  };

  const blocked = validateAdminGrantCandidate("candidate@example.com", candidate, MAX_ADMINS);
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.code, "MAX_LIMIT_REACHED");

  const allowed = validateAdminGrantCandidate("  CANDIDATE@example.com ", candidate, MAX_ADMINS - 1);
  assert.deepEqual(allowed, {
    ok: true,
    normalizedEmail: "candidate@example.com",
    alreadyAdmin: false
  });

  const existingAdmin = validateAdminGrantCandidate("candidate@example.com", { ...candidate, is_admin: true }, MAX_ADMINS);
  assert.deepEqual(existingAdmin, {
    ok: true,
    normalizedEmail: "candidate@example.com",
    alreadyAdmin: true
  });
});

const COUNTS = {
  users: 2500, admins: 2, newUsers7d: 40, cvs: 1800, evaluations: 1200, analyses: 3100, highMatch: 900,
  interviews: 400, interviewsCompleted: 250, interviewsInProgress: 150, answers: 1100,
  txSuccess: 3, txPending: 1, txCancelled: 1, activeJobs: 42
};

test("overview figures come from exact counts, not from how many rows were loaded", () => {
  const overview = buildAdminOverview({
    now: Date.parse("2026-11-07T12:00:00.000Z"),
    counts: COUNTS,
    credits: [3, 1, 0],
    qualityScores: [80, 91],
    rciScores: [75, 54],
    successAmounts: [29000, 29000, 29000],
    admins: [
      { id: "u1", user_code: "81047992", email: "admin@example.com", full_name: "Admin One", created_at: "2026-11-05T00:00:00.000Z" },
      { id: "00000000-0000-4000-8000-000000000002", user_code: null, email: "second@example.com", full_name: "Admin Two", created_at: "2026-11-06T00:00:00.000Z" }
    ],
    recentTransactions: Array.from({ length: 10 }, (_, index) => ({
      order_code: 1000 + index, amount: 29000, status: "SUCCESS" as const, created_at: "2026-11-06T00:00:00.000Z", user_email: null
    })),
    lastJobSyncAt: "2026-11-07T08:00:00.000Z"
  });

  // Totals above 1,000 stay exact: they are counted by the database, not taken from a capped row list.
  assert.deepEqual(overview.users, { total: 2500, admins: 2, new_last_7d: 40, total_credits: 4 });
  assert.deepEqual(overview.cvs, { total: 1800, evaluations_total: 1200, avg_quality_score: 86 });
  assert.deepEqual(overview.analyses, { total: 3100, avg_rci_score: 65, high_match_count: 900 });
  assert.deepEqual(overview.interviews, { total: 400, completed: 250, in_progress: 150, answers_total: 1100 });
  assert.equal(overview.revenue.total_vnd, 87000);
  assert.deepEqual([overview.revenue.success_count, overview.revenue.pending_count, overview.revenue.cancelled_count], [3, 1, 1]);
  assert.equal(overview.revenue.recent_transactions.length, 8);
  assert.deepEqual(overview.rules, { max_admins: MAX_ADMINS, current_admins: 2, remaining_slots: 1 });
  assert.equal(overview.jobs.active_count, 42);
  assert.deepEqual(overview.admins.map((admin) => admin.user_code), ["81047992", deriveUserCode("00000000-0000-4000-8000-000000000002")]);
});

test("averages are empty, not zero, when nothing has been scored yet", () => {
  const overview = buildAdminOverview({
    counts: { ...COUNTS, evaluations: 0, analyses: 0 }, credits: [], qualityScores: [], rciScores: [], successAmounts: [],
    admins: [], recentTransactions: [], lastJobSyncAt: null
  });
  assert.equal(overview.cvs.avg_quality_score, null);
  assert.equal(overview.analyses.avg_rci_score, null);
  assert.equal(overview.revenue.total_vnd, 0);
  assert.equal(overview.users.total_credits, 0);
});

test("paged reads collect every row even when the server returns fewer rows than asked", async () => {
  const table = Array.from({ length: 5 }, (_, index) => index);
  const asked: [number, number][] = [];
  // The server caps each response at 2 rows although 4 were requested.
  const rows = await readAllPages<number>(async (from, to) => {
    asked.push([from, to]);
    return { data: table.slice(from, Math.min(to + 1, from + 2)), error: null };
  }, 4);
  assert.deepEqual(rows, [0, 1, 2, 3, 4]);
  assert.deepEqual(asked.map(([from]) => from), [0, 2, 4, 5]);
});

test("paged reads stop at a past-the-end page and report any other error", async () => {
  const pastEnd = await readAllPages<number>(async (from) =>
    from === 0 ? { data: [1, 2], error: null } : { data: null, error: { code: "PGRST103", message: "Requested range not satisfiable" } }, 2);
  assert.deepEqual(pastEnd, [1, 2]);
  await assert.rejects(readAllPages<number>(async () => ({ data: null, error: { code: "42501", message: "permission denied" } })),
    // Supabase errors are plain objects, so the check matches their fields rather than a message string.
    { code: "42501", message: "permission denied" });
});

test("user search drops filter syntax and the 8-digit code falls back to the derived one", () => {
  assert.deepEqual(searchWords("  nguyen,(admin)  81047992 "), ["nguyen", "admin", "81047992"]);
  assert.deepEqual(searchWords("a%b_c*d"), ["a", "b", "c", "d"]);
  assert.deepEqual(searchWords(undefined), []);
  assert.equal(userCodeOf({ id: "x", user_code: "12345678" }), "12345678");
  assert.equal(userCodeOf({ id: "00000000-0000-4000-8000-000000000002", user_code: "bad" }), deriveUserCode("00000000-0000-4000-8000-000000000002"));
});
