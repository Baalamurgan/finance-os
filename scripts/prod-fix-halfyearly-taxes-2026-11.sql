-- Half-yearly taxes NOT paid in October 2026 — remove the four "Marked … bill already paid (outside)" records
-- (12 Oct, ₹0 moved, no card) so the Oct–Mar half-year counts as UNPAID. October and November amounts don't
-- change (these records moved no money and Oct/Nov have no lines for them); from December the preview sets
-- aside (full bill − already saved) ÷ months to the March deadline. Arni house Property tax WAS paid — untouched.
-- Then: Sheet → December preview → Refresh.
-- Expected: DELETE 4 (a re-run prints DELETE 0).
BEGIN;
DELETE FROM "BillPayment"
WHERE id IN (52, 54, 55, 56)
  AND "categoryId" IN (33, 34, 50, 51)            -- BFC Property · Kanniyammal Property · BFC Water · Kanniyammal Water
  AND "periodId" = (SELECT id FROM "Period" WHERE year = 2026 AND month = 10)
  AND "fromFund" = 0 AND "fromSetAside" = 0 AND "fromPiggy" = 0 AND "outOfPocket" = 0
  AND "cardAccountId" IS NULL;
COMMIT;
