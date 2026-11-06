-- ManualPlanStep.doneAt: when the step was ticked done (null = not done, or ticked before this column
-- existed → the Transactions tab falls back to its planned day). Nullable add — safe for the running app.
ALTER TABLE "ManualPlanStep" ADD COLUMN "doneAt" TIMESTAMP(3);
