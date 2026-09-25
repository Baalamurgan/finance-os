-- Loan Management module: amortization/master fields + Spend↔Loan linkage. All additive (nullable or
-- defaulted), so existing loans/chits and every other row stay valid. Apply to prod with
-- `prisma migrate deploy` when ready (local dev uses `prisma db push`).

-- Loan master fields for the amortization engine
ALTER TABLE "Loan" ADD COLUMN "originalPrincipal" DOUBLE PRECISION;
ALTER TABLE "Loan" ADD COLUMN "originalTenureMonths" INTEGER;
ALTER TABLE "Loan" ADD COLUMN "startDate" TIMESTAMP(3);
ALTER TABLE "Loan" ADD COLUMN "emiAmount" DOUBLE PRECISION;
ALTER TABLE "Loan" ADD COLUMN "prepaymentStrategy" TEXT NOT NULL DEFAULT 'reduce_tenure';

-- LoanPayment: auditable actuals + link back to the source Spend line
ALTER TABLE "LoanPayment" ADD COLUMN "interestPart" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "LoanPayment" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'emi';
ALTER TABLE "LoanPayment" ADD COLUMN "paidOn" TIMESTAMP(3);
ALTER TABLE "LoanPayment" ADD COLUMN "expenseEntryId" INTEGER;
CREATE UNIQUE INDEX "LoanPayment_expenseEntryId_key" ON "LoanPayment"("expenseEntryId");

-- Spend → Loan link (a planned EMI/prepayment bill). The same line that already reduces budget-in-hand
-- is the plan; marking it paid creates the LoanPayment. No duplicate transaction.
ALTER TABLE "ExpenseEntry" ADD COLUMN "loanId" INTEGER;
ALTER TABLE "ExpenseEntry" ADD COLUMN "loanPaymentType" TEXT;

-- Recurring EMI template link (scalars, matching RecurringItem's relation-free style)
ALTER TABLE "RecurringItem" ADD COLUMN "loanId" INTEGER;
ALTER TABLE "RecurringItem" ADD COLUMN "loanPaymentType" TEXT;

-- Foreign keys (SET NULL so deleting a loan/spend reverses cleanly without orphaning history)
ALTER TABLE "ExpenseEntry"
  ADD CONSTRAINT "ExpenseEntry_loanId_fkey"
  FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LoanPayment"
  ADD CONSTRAINT "LoanPayment_expenseEntryId_fkey"
  FOREIGN KEY ("expenseEntryId") REFERENCES "ExpenseEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Saved what-if plan (per-month EMI overrides) for the Planned schedule.
ALTER TABLE "Loan" ADD COLUMN "plannedOverrides" JSONB;

-- Interest-only loans (gold/jewel): monthly interest, principal cleared separately; no amortization.
ALTER TABLE "Loan" ADD COLUMN "interestOnly" BOOLEAN NOT NULL DEFAULT false;
