-- Add the payback (return) leg to funding advances: borrower → funder once their income lands.
ALTER TABLE "Advance" ADD COLUMN IF NOT EXISTS "paybackDay" INTEGER;
ALTER TABLE "Advance" ADD COLUMN IF NOT EXISTS "paybackSettled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Advance" ADD COLUMN IF NOT EXISTS "paybackSettledAt" TIMESTAMP(3);
