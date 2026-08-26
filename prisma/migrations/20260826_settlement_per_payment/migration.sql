-- Per-payment settlement model.
--
-- A settlement can now be paid in several slices (one per Money-Plan piece ticked), so there may be
-- MANY SettlementRecord rows per (period, from, to). A pair's total paid = SUM of its rows. This
-- replaces the old single-cumulative-number-per-pair model, which made ticking a small piece record a
-- big running total (and collapse/reshuffle the plan).
--
-- `key` is the ticked step's stable id. Ticking upserts on (period, key), so a double-click updates
-- the same row instead of double-recording a payment.

ALTER TABLE "SettlementRecord" ADD COLUMN "key" TEXT;

-- Old one-row-per-pair uniqueness no longer holds.
DROP INDEX "SettlementRecord_periodId_fromMemberId_toMemberId_key";

-- Keep a plain (non-unique) index for pair lookups.
CREATE INDEX "SettlementRecord_periodId_fromMemberId_toMemberId_idx"
  ON "SettlementRecord" ("periodId", "fromMemberId", "toMemberId");

-- Idempotency: one row per (period, ticked-step key). Existing rows have key = NULL; Postgres treats
-- NULLs as distinct, so the current rows coexist fine and don't violate this.
CREATE UNIQUE INDEX "SettlementRecord_periodId_key_key"
  ON "SettlementRecord" ("periodId", "key");
