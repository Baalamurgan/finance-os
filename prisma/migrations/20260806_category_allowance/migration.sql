-- Allowance flag: a Monthly expense category that is a member's personal spending money the family
-- sends them (not a bill they owe). Idempotent so it's safe whether applied by hand or migrate deploy.
ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "isAllowance" BOOLEAN NOT NULL DEFAULT false;

-- Seed the two known allowances for the JAI SAI RAM household (match by name; no-op elsewhere).
UPDATE "Category" SET "isAllowance" = true
WHERE "name" IN ('Harish expense', 'VL expense') AND "section" = 'Monthly';
