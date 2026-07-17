-- Where a bill payment's money actually moved. Normally equals periodId; for a CARRIED (late)
-- payment of a prior closed month's bill it's the current OPEN month, so undo reverses the
-- fund/Piggy draws and out-of-pocket Misc spend against the right period.
ALTER TABLE "BillPayment" ADD COLUMN "spendPeriodId" INTEGER;
