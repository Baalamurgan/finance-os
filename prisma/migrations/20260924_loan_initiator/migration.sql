-- Loan initiator: the member who CREATED a linked lend/borrow pair (manual lend, peer-card spend, or
-- split/reimbursement). Lets the one-time heads-up notify the OTHER side — the person who didn't
-- initiate it — regardless of direction. Nullable: legacy rows fall back to the spend-payer heuristic.
ALTER TABLE "PersonalLoan" ADD COLUMN "initiatedById" INTEGER;
