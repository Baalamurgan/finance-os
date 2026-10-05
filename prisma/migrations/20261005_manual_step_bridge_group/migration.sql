-- Repayable bridge grouping: links the 3 steps of one bridge (funder→debtor, debtor→hub, hub→funder)
-- so they delete as a unit. Additive + nullable — existing rows stay valid, no plan line changes.
ALTER TABLE "ManualPlanStep" ADD COLUMN "bridgeGroup" TEXT;
