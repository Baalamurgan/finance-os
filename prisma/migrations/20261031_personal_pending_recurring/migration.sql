-- Plan-driven budget: recurring bills/spends become pending plan steps that do NOT count in Can-spend
-- until their step is ticked (executed). Additive + defaulted false, so existing rows keep counting
-- (forward-only — only seedRecurring sets pending = true on newly cloned recurring rows).

-- AlterTable
ALTER TABLE "PersonalExpense" ADD COLUMN     "pending" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "PersonalSpend" ADD COLUMN     "pending" BOOLEAN NOT NULL DEFAULT false;
