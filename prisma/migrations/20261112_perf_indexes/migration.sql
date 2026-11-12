-- Indexes for the per-month lookups every page makes (spends, sheet lines, advances, piggy, plan steps,
-- refunds, bills, personal spends/expenses/income). Postgres doesn't index foreign keys on its own, so
-- these were full-table scans. Additive only: no data changes. IF NOT EXISTS makes it safe to re-run.
CREATE INDEX IF NOT EXISTS "Spend_periodId_idx" ON "Spend"("periodId");
CREATE INDEX IF NOT EXISTS "IncomeEntry_periodId_idx" ON "IncomeEntry"("periodId");
CREATE INDEX IF NOT EXISTS "ExpenseEntry_periodId_idx" ON "ExpenseEntry"("periodId");
CREATE INDEX IF NOT EXISTS "Advance_periodId_idx" ON "Advance"("periodId");
CREATE INDEX IF NOT EXISTS "PiggyEntry_periodId_idx" ON "PiggyEntry"("periodId");
CREATE INDEX IF NOT EXISTS "ManualPlanStep_periodId_idx" ON "ManualPlanStep"("periodId");
CREATE INDEX IF NOT EXISTS "SpendRefund_periodId_idx" ON "SpendRefund"("periodId");
CREATE INDEX IF NOT EXISTS "BillPayment_periodId_idx" ON "BillPayment"("periodId");
CREATE INDEX IF NOT EXISTS "LoanPayment_loanId_idx" ON "LoanPayment"("loanId");
CREATE INDEX IF NOT EXISTS "PersonalSpend_memberId_periodId_idx" ON "PersonalSpend"("memberId", "periodId");
CREATE INDEX IF NOT EXISTS "PersonalExpense_memberId_periodId_idx" ON "PersonalExpense"("memberId", "periodId");
CREATE INDEX IF NOT EXISTS "PersonalIncome_memberId_periodId_idx" ON "PersonalIncome"("memberId", "periodId");
