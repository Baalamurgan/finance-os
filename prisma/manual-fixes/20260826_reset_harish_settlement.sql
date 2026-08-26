-- MANUAL DATA CORRECTION — apply ONCE, by hand, AFTER the 20260826_settlement_per_payment migration
-- and the new code are deployed.
--
-- Background: under the old single-record model, ticking Money-Plan pieces for Harish accumulated the
-- settlement record to ₹16,680 (record id 21, Arumugam → Harish, period 17 / AUG), even though only
-- ₹2,780 actually moved (dad's Chimney EMI funding). The figure is a phantom created by the old
-- cumulative behaviour.
--
-- Cleanest reset: DELETE the phantom row so Harish's settlement starts from zero paid. Then, in the
-- FIXED Money Plan, tick the real ₹2,780 Chimney-funding piece — it now records exactly ₹2,780 as one
-- payment, and each future slice is its own line. (If Harish has already paid the Chimney EMI from that
-- money, also mark that bill paid so the plan doesn't re-schedule its funding.)
--
-- Verify before: expect one row, amount 16680.
--   SELECT id, "fromMemberId", "toMemberId", amount FROM "SettlementRecord" WHERE id = 21;

DELETE FROM "SettlementRecord" WHERE id = 21 AND "periodId" = 17 AND amount = 16680;

-- Verify after: expect no rows.
--   SELECT id FROM "SettlementRecord" WHERE id = 21;
