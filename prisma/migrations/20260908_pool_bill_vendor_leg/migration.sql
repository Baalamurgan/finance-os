-- Two-step pool-funded misc (note=__poolbill__): the treasurer disburses to the member (leg 1, tracked
-- by the existing `paid`/`paidAt`), and the member then pays the vendor (leg 2). Leg 2 ticks
-- independently — like an advance's front + payback — so it needs its own done state. These columns hold
-- it; they're unused (false/null) for every other expense line.
ALTER TABLE "ExpenseEntry" ADD COLUMN IF NOT EXISTS "vendorPaid" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ExpenseEntry" ADD COLUMN IF NOT EXISTS "vendorPaidAt" TIMESTAMP(3);
