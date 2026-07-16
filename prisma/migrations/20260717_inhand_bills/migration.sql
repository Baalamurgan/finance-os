-- "Budget left in hand" now counts all tagged bills (loans/chits/plain) as held cash, with
-- a per-bill "paid" flag; and the Piggy/pool can be held by a configurable member.
ALTER TABLE "ExpenseEntry" ADD COLUMN "paid" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Household" ADD COLUMN "piggyHolderMemberId" INTEGER;
