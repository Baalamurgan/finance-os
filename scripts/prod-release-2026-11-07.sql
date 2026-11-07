-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- PROD RELEASE · 7 Nov 2026 — run this ONCE in the Supabase SQL editor, right BEFORE pushing the code.
-- One transaction: if anything fails, nothing changes. Safe to re-run (every statement is guarded).
--   Part A · schema  — Setup templates, Net worth, personal account flag (adds only; the running app is fine)
--   Part B · data    — Baala's November correction
-- After it: SBI ₹16,554 · HDFC - Company ₹4,938 · HSBC ₹25,000 · Jupiter ₹32,985.41
--           Can spend ₹10,150.41 · In account now (Jupiter) ₹32,985.41
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
BEGIN;

-- ── Part A · schema ───────────────────────────────────────────────────────────────────────────────
-- Personal Setup templates kept apart from the months (all additive / nullable — safe for the running app).
CREATE TABLE IF NOT EXISTS "PersonalTemplate" (
  "id" SERIAL PRIMARY KEY,
  "memberId" INTEGER NOT NULL REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "kind" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "dayOfMonth" INTEGER NOT NULL DEFAULT 1,
  "categoryId" INTEGER,
  "cardAccountId" INTEGER,
  "payAccountId" INTEGER,
  "accountId" INTEGER,
  "note" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "PersonalTemplate_memberId_idx" ON "PersonalTemplate"("memberId");
ALTER TABLE "PersonalIncome"  ADD COLUMN IF NOT EXISTS "templateId" INTEGER;
ALTER TABLE "PersonalExpense" ADD COLUMN IF NOT EXISTS "templateId" INTEGER;
ALTER TABLE "PersonalSpend"   ADD COLUMN IF NOT EXISTS "templateId" INTEGER;
ALTER TABLE "PersonalPeriod"  ADD COLUMN IF NOT EXISTS "planSeededAt" TIMESTAMP(3);
ALTER TABLE "Member"          ADD COLUMN IF NOT EXISTS "personalTemplatesAt" TIMESTAMP(3);

-- Net worth tab: holding details + dated history + monthly snapshots + "adds to holding" links (all additive).
ALTER TABLE "NetWorthItem" ADD COLUMN IF NOT EXISTS "startDate" TIMESTAMP(3);
ALTER TABLE "NetWorthItem" ADD COLUMN IF NOT EXISTS "tenureMonths" INTEGER;
ALTER TABLE "NetWorthItem" ADD COLUMN IF NOT EXISTS "interestRate" DOUBLE PRECISION;
ALTER TABLE "NetWorthItem" ADD COLUMN IF NOT EXISTS "valueAsOf" TIMESTAMP(3);
CREATE TABLE IF NOT EXISTS "NetWorthEntry" (
  "id" SERIAL PRIMARY KEY,
  "memberId" INTEGER NOT NULL,
  "itemId" INTEGER NOT NULL REFERENCES "NetWorthItem"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "date" TIMESTAMP(3) NOT NULL,
  "kind" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "note" TEXT,
  "planStepId" INTEGER,
  "spendId" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "NetWorthEntry_itemId_idx" ON "NetWorthEntry"("itemId");
CREATE INDEX IF NOT EXISTS "NetWorthEntry_memberId_idx" ON "NetWorthEntry"("memberId");
CREATE TABLE IF NOT EXISTS "NetWorthSnapshot" (
  "id" SERIAL PRIMARY KEY,
  "memberId" INTEGER NOT NULL,
  "year" INTEGER NOT NULL,
  "month" INTEGER NOT NULL,
  "netWorth" DOUBLE PRECISION NOT NULL,
  "assets" DOUBLE PRECISION NOT NULL,
  "liabilities" DOUBLE PRECISION NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "NetWorthSnapshot_memberId_year_month_key" ON "NetWorthSnapshot"("memberId", "year", "month");
ALTER TABLE "PersonalTemplate" ADD COLUMN IF NOT EXISTS "holdingId" INTEGER;
ALTER TABLE "PersonalPlanItem" ADD COLUMN IF NOT EXISTS "holdingId" INTEGER;
ALTER TABLE "PersonalExpense"  ADD COLUMN IF NOT EXISTS "holdingId" INTEGER;
ALTER TABLE "PersonalSpend"    ADD COLUMN IF NOT EXISTS "holdingId" INTEGER;
ALTER TABLE "PersonalPlanStep" ADD COLUMN IF NOT EXISTS "holdingId" INTEGER;
ALTER TABLE "FinanceAccount" ADD COLUMN IF NOT EXISTS "personalPrimary" BOOLEAN NOT NULL DEFAULT false;

-- ── Part B · data (Baala, member 3) ──────────────────────────────────────────────────────────────
-- 1) October's carry into November → ₹0
UPDATE "PersonalPeriod" SET "carryForward" = 0
WHERE id = 9 AND "memberId" = 3 AND round("carryForward"::numeric, 2) = 3468.18;

-- 2) One-off Sheet line so the month's money is ₹11,087: ₹1,77,790 salary − ₹1,26,704 bills − ₹39,999
INSERT INTO "PersonalExpense" ("memberId", "periodId", "categoryId", label, amount, note, date, recurring, pending, "createdAt")
SELECT 3, 9, NULL, 'Opening adjustment (Nov)', 39999, 'Salary left in HDFC - Company after the SBI + Jupiter transfers (card bills). One-off reset so Can spend = actual.', '2026-11-01 06:30:00', false, false, now()
WHERE NOT EXISTS (SELECT 1 FROM "PersonalExpense" WHERE "periodId" = 9 AND label = 'Opening adjustment (Nov)');
UPDATE "PersonalExpense" SET amount = 39999
WHERE "periodId" = 9 AND "memberId" = 3 AND label = 'Opening adjustment (Nov)' AND amount <> 39999;

-- 3) HSBC bank account with ₹25,000
INSERT INTO "FinanceAccount" ("memberId", type, name, institution, color, active, reimbursed, "familyPrimary", "personalPrimary", "sortOrder", "openingBalance", "createdAt")
SELECT 3, 'bank', 'HSBC', 'HSBC', '#db0011', true, false, false, false, 99, 25000, now()
WHERE NOT EXISTS (SELECT 1 FROM "FinanceAccount" WHERE "memberId" = 3 AND name = 'HSBC');

-- 4) The SBI MOD FD (₹58,895, booked 6 Nov) left SBI: tick its plan step at the real amount + debit SBI
UPDATE "PersonalPlanStep" SET status = 'done', "doneAt" = '2026-11-06 10:40:00', amount = 58895, "fromAccountId" = 14
WHERE id = 25 AND "memberId" = 3 AND kind = 'save' AND status = 'pending';
INSERT INTO "AccountTransaction" ("memberId", "accountId", date, merchant, amount, type, category, "needsReview", source, "createdAt")
SELECT 3, 14, '2026-11-06 10:40:00', 'SBI MOD FD', 58895, 'spend', '__planstep__:25', false, 'manual', now()
WHERE NOT EXISTS (SELECT 1 FROM "AccountTransaction" WHERE "memberId" = 3 AND category = '__planstep__:25');

-- 5) Jupiter is the personal account ("UPI" spends and lending money move it; In account shows its balance)
UPDATE "FinanceAccount" SET "personalPrimary" = true
WHERE id = 16 AND "memberId" = 3 AND "personalPrimary" = false;

-- 6) Netflix was ₹296, not ₹300 — its Jupiter debit follows
UPDATE "AccountTransaction" SET amount = 296
WHERE "memberId" = 3 AND category = '__spendpay__:293' AND amount = 300;

-- 7) November's UPI spends (no account picked) come out of Jupiter, like every new one will
INSERT INTO "AccountTransaction" ("memberId", "accountId", date, merchant, amount, type, category, "needsReview", source, "personalSpendId", "createdAt")
SELECT s."memberId", 16, s.date, COALESCE(NULLIF(trim(s.note), ''), 'Spend'), s.amount, 'spend', c.name, false, 'personal', s.id, now()
FROM "PersonalSpend" s JOIN "PersonalCategory" c ON c.id = s."categoryId"
WHERE s."memberId" = 3 AND s."periodId" = 9 AND s."cardAccountId" IS NULL AND s."payAccountId" IS NULL AND s.pending = false
  AND NOT EXISTS (SELECT 1 FROM "AccountTransaction" t WHERE t."personalSpendId" = s.id)
  AND NOT EXISTS (SELECT 1 FROM "AccountTransaction" t WHERE t."memberId" = 3 AND t.category = '__spendpay__:' || s.id);

-- 8) Jupiter's opening balance so it reads exactly ₹32,985.41 (worked out from its lines; first run only)
UPDATE "FinanceAccount" f SET "openingBalance" = round((32985.41 - COALESCE((
  SELECT sum(CASE WHEN t.type IN ('topup', 'refund', 'cashback', 'adjustment', 'transfer_in') THEN t.amount
                  WHEN t.type IN ('spend', 'fee', 'interest', 'charge', 'transfer_out') THEN -t.amount ELSE 0 END)
  FROM "AccountTransaction" t WHERE t."accountId" = 16), 0))::numeric, 2)
WHERE f.id = 16 AND f."memberId" = 3 AND f."openingBalance" = 26439;

-- 9) SBI is Baala's family account (holds his family In-Hand; card-bill shares move to/from it)
UPDATE "FinanceAccount" SET "familyPrimary" = true
WHERE id = 14 AND "memberId" = 3 AND "familyPrimary" = false;

COMMIT;
