-- PersonalPlanStep.position (manual order) + .snapshot (original template values behind a month-only edit).
-- Nullable add-columns only.
ALTER TABLE "PersonalPlanStep" ADD COLUMN "position" DOUBLE PRECISION;
ALTER TABLE "PersonalPlanStep" ADD COLUMN "snapshot" JSONB;
