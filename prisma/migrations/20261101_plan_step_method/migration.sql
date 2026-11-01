-- PersonalPlanStep.method: how a plan step's money moves (upi | cash | card | other). Nullable add-column only.
ALTER TABLE "PersonalPlanStep" ADD COLUMN "method" TEXT;
