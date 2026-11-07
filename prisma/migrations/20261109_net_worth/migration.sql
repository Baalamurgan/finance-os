-- Net worth tab: holding details + dated history + monthly snapshots + "adds to holding" links (all additive).
ALTER TABLE "NetWorthItem" ADD COLUMN "startDate" TIMESTAMP(3);
ALTER TABLE "NetWorthItem" ADD COLUMN "tenureMonths" INTEGER;
ALTER TABLE "NetWorthItem" ADD COLUMN "interestRate" DOUBLE PRECISION;
ALTER TABLE "NetWorthItem" ADD COLUMN "valueAsOf" TIMESTAMP(3);
CREATE TABLE "NetWorthEntry" (
  "id" SERIAL PRIMARY KEY,
  "memberId" INTEGER NOT NULL,
  "itemId" INTEGER NOT NULL REFERENCES "NetWorthItem"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "date" TIMESTAMP(3) NOT NULL,
  "kind" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "note" TEXT,
  "planStepId" INTEGER,
  "spendId" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "NetWorthEntry_itemId_idx" ON "NetWorthEntry"("itemId");
CREATE INDEX "NetWorthEntry_memberId_idx" ON "NetWorthEntry"("memberId");
CREATE TABLE "NetWorthSnapshot" (
  "id" SERIAL PRIMARY KEY,
  "memberId" INTEGER NOT NULL,
  "year" INTEGER NOT NULL,
  "month" INTEGER NOT NULL,
  "netWorth" DOUBLE PRECISION NOT NULL,
  "assets" DOUBLE PRECISION NOT NULL,
  "liabilities" DOUBLE PRECISION NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "NetWorthSnapshot_memberId_year_month_key" ON "NetWorthSnapshot"("memberId", "year", "month");
ALTER TABLE "PersonalTemplate" ADD COLUMN "holdingId" INTEGER;
ALTER TABLE "PersonalPlanItem" ADD COLUMN "holdingId" INTEGER;
ALTER TABLE "PersonalExpense"  ADD COLUMN "holdingId" INTEGER;
ALTER TABLE "PersonalSpend"    ADD COLUMN "holdingId" INTEGER;
ALTER TABLE "PersonalPlanStep" ADD COLUMN "holdingId" INTEGER;
ALTER TABLE "FinanceAccount" ADD COLUMN "personalPrimary" BOOLEAN NOT NULL DEFAULT false;
