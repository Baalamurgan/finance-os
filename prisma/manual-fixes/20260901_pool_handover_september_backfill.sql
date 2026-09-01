-- September 2026 one-time backfill for the PoolHandover feature.
-- August wound down (leftovers → income) and the general Piggy was taken as September income BEFORE
-- this feature existed, so the hand-over rows weren't recorded. Confirmed from the data:
--   • Baala holds ₹407 budget leftover (LPG Gas ₹32 + Petrol ₹375) — kind 'leftover'
--   • Baala holds ₹7,779 general Piggy taken as income          — kind 'piggy'
--   • Arumugam (treasurer) owns the other ₹5,646 of the ₹6,053 leftover — already at the hub, no row.
-- Idempotent: safe to run more than once. From the NEXT wind-down / Piggy use on, these are recorded
-- automatically.
--
-- Run AFTER applying migration 20260901_pool_handovers.

-- 1) Baala's leftover slice.
INSERT INTO "PoolHandover" ("periodId", "householdId", "fromMemberId", "kind", "amount", "detail")
SELECT pr.id, pr."householdId", m.id, 'leftover', 407, 'LPG Gas, Petrol'
FROM "Period" pr
JOIN "Member" m ON m."householdId" = pr."householdId" AND m.name = 'Baala'
WHERE pr.label = 'SEP 2026' AND pr.status = 'open'
ON CONFLICT ("periodId", "fromMemberId", "kind") DO NOTHING;

-- 2) Baala's general-Piggy slice.
INSERT INTO "PoolHandover" ("periodId", "householdId", "fromMemberId", "kind", "amount", "detail")
SELECT pr.id, pr."householdId", m.id, 'piggy', 7779, NULL
FROM "Period" pr
JOIN "Member" m ON m."householdId" = pr."householdId" AND m.name = 'Baala'
WHERE pr.label = 'SEP 2026' AND pr.status = 'open'
ON CONFLICT ("periodId", "fromMemberId", "kind") DO NOTHING;

-- 3) Tag the existing "From Piggy" September income so a later delete re-syncs the piggy hand-over
--    (new withdrawals set this note automatically; this fixes the pre-feature line).
UPDATE "IncomeEntry"
SET "note" = '__piggy_income__'
WHERE "note" IS NULL
  AND "source" LIKE 'From Piggy%'
  AND "periodId" = (SELECT id FROM "Period" WHERE label = 'SEP 2026' AND status = 'open' LIMIT 1);
