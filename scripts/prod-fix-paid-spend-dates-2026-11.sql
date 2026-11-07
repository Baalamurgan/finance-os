-- Planned (Setup) personal spends that were marked PAID kept their planned date (e.g. Netflix "15 Nov")
-- instead of the day they were paid. Set each one's date to the day it was actually paid — taken from the
-- account line written at that moment (card mirror via personalSpendId, or the bank/UPI "__spendpay__" line).
-- Amounts, months and Can-spend don't change; only the date shown and the Spends list order.
-- Expected (from the local copy): UPDATE 1 — #293 Netflix (extra screen), Jupiter, 15 Nov → 6 Nov.
-- A re-run prints UPDATE 0.
BEGIN;
UPDATE "PersonalSpend" s
SET date = t.date
FROM "AccountTransaction" t
WHERE s.pending = false
  AND s."templateId" IS NOT NULL
  AND (t."personalSpendId" = s.id OR t.category = '__spendpay__:' || s.id)
  AND t."memberId" = s."memberId"
  AND t.date::date <> s.date::date;
COMMIT;
