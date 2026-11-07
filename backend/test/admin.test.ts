import assert from "node:assert/strict";
import test from "node:test";
import { buildAdminOverview, MAX_ADMINS, validateAdminGrantCandidate } from "../src/admin";

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

test("aggregates overview metrics across users, CVs, analyses, interviews and PayOS revenue", () => {
  const now = Date.parse("2026-11-07T12:00:00.000Z");
  const overview = buildAdminOverview({
    now,
    users: [
      { id: "u1", email: "admin@example.com", full_name: "Admin One", credits: 3, is_admin: true, created_at: "2026-11-05T00:00:00.000Z" },
      { id: "u2", email: "member@example.com", full_name: "Member Two", credits: 1, is_admin: false, created_at: "2026-10-01T00:00:00.000Z" }
    ],
    cvCount: 4,
    evaluations: [{ quality_score: 80 }, { quality_score: 90 }],
    analyses: [{ rci_score: 75 }, { rci_score: 55 }],
    interviews: [{ status: "COMPLETED" }, { status: "IN_PROGRESS" }],
    answerCount: 5,
    transactions: [
      { order_code: 1001, amount: 29000, status: "SUCCESS", created_at: "2026-11-06T00:00:00.000Z", user_email: "member@example.com" },
      { order_code: 1002, amount: 29000, status: "PENDING", created_at: "2026-11-06T01:00:00.000Z", user_email: "member@example.com" },
      { order_code: 1003, amount: 29000, status: "CANCELLED", created_at: "2026-11-06T02:00:00.000Z", user_email: "admin@example.com" }
    ],
    activeJobCount: 42,
    lastJobSyncAt: "2026-11-07T08:00:00.000Z"
  });

  assert.equal(overview.rules.max_admins, 3);
  assert.equal(overview.rules.current_admins, 1);
  assert.equal(overview.rules.remaining_slots, 2);
  assert.deepEqual(overview.users, { total: 2, admins: 1, new_last_7d: 1, total_credits: 4 });
  assert.deepEqual(overview.cvs, { total: 4, evaluations_total: 2, avg_quality_score: 85 });
  assert.deepEqual(overview.analyses, { total: 2, avg_rci_score: 65, high_match_count: 1 });
  assert.deepEqual(overview.interviews, { total: 2, completed: 1, in_progress: 1, answers_total: 5 });
  assert.equal(overview.revenue.total_vnd, 29000);
  assert.equal(overview.revenue.success_count, 1);
  assert.equal(overview.revenue.pending_count, 1);
  assert.equal(overview.revenue.cancelled_count, 1);
  assert.equal(overview.jobs.active_count, 42);
  assert.equal(overview.admins.length, 1);
  assert.equal(overview.admins[0]?.email, "admin@example.com");
});

