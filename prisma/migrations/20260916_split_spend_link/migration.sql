-- Link a split/reimbursement receivable back to the personal spend it came from, so the
-- spend row can show your real out-of-pocket as people pay back or are dropped.
ALTER TABLE "PersonalLoan" ADD COLUMN "spendId" INTEGER;
CREATE INDEX "PersonalLoan_spendId_idx" ON "PersonalLoan"("spendId");
ALTER TABLE "PersonalLoan"
  ADD CONSTRAINT "PersonalLoan_spendId_fkey"
  FOREIGN KEY ("spendId") REFERENCES "PersonalSpend"("id") ON DELETE SET NULL ON UPDATE CASCADE;
