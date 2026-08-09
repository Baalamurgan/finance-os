-- When a bill line was marked paid — lets the Money plan show "paid <day>" when the actual paid
-- day differs from the due day. Nullable; backfilled from createdAt only where already paid so the
-- existing paid bills have a sensible (if approximate) timestamp.
ALTER TABLE "ExpenseEntry" ADD COLUMN IF NOT EXISTS "paidAt" TIMESTAMP(3);
UPDATE "ExpenseEntry" SET "paidAt" = "createdAt" WHERE "paid" = true AND "paidAt" IS NULL;
