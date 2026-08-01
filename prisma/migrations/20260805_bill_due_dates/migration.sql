-- Money Plan: per-line due day (expenses) / arrival day (income), copied from the template on
-- generation so In-Hand can flag overdue / near-due bills and (Phase B) order the plan by date.
ALTER TABLE "ExpenseEntry" ADD COLUMN "dueDay" INTEGER;
ALTER TABLE "IncomeEntry"  ADD COLUMN "dueDay" INTEGER;

-- Backfill existing rows from the recurring template that generated them, so dates set in Setup
-- show on the CURRENT month without a rebuild. Best-effort match (category + label / source).
UPDATE "ExpenseEntry" e
SET "dueDay" = r."dueDay"
FROM "RecurringItem" r, "Period" p
WHERE e."periodId" = p."id"
  AND r."householdId" = p."householdId"
  AND r."kind" = 'expense'
  AND r."dueDay" IS NOT NULL
  AND r."categoryId" = e."categoryId"
  AND (e."label" = r."name" OR e."label" LIKE r."name" || ' %');

UPDATE "IncomeEntry" i
SET "dueDay" = r."dueDay"
FROM "RecurringItem" r, "Period" p
WHERE i."periodId" = p."id"
  AND r."householdId" = p."householdId"
  AND r."kind" = 'income'
  AND r."dueDay" IS NOT NULL
  AND i."source" = r."name"
  AND (i."ownerId" = r."memberId" OR (i."ownerId" IS NULL AND r."memberId" IS NULL));
