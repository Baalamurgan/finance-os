-- MANUAL DATA CORRECTION — apply once, by hand (prod writes are not automated).
--
-- Context: On Aug 24, Arumugam ticked a ₹2,780 funding piece of Harish's Money-Plan
-- disbursement. Because ticking a piece USED TO record the creditor's full net, the
-- SettlementRecord was written as ₹52,454 (Harish's entire owed amount) even though only
-- ₹2,780 actually moved. Harish is therefore marked fully paid but is still owed ₹49,674.
--
-- This resets the record to what actually moved (₹2,780). After applying, the Money Plan
-- will show a ₹2,780 done line plus ₹49,674 of pending pieces for Harish — the true state.
--
-- The code change in moneyPlan.ts (piece tick records paid-so-far + that slice) prevents
-- this from recurring.
--
-- Record: id=21, period 17 (AUG 2026), Arumugam (member 4) → Harish (member 2).

UPDATE "SettlementRecord" SET amount = 2780 WHERE id = 21 AND amount = 52454;

-- Verify (expect amount = 2780):
-- SELECT id, "fromMemberId", "toMemberId", amount, "settledAt" FROM "SettlementRecord" WHERE id = 21;
