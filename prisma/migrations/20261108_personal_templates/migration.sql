-- Personal Setup templates kept apart from the months (all additive / nullable — safe for the running app).
CREATE TABLE "PersonalTemplate" (
  "id" SERIAL PRIMARY KEY,
  "memberId" INTEGER NOT NULL REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "kind" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "dayOfMonth" INTEGER NOT NULL DEFAULT 1,
  "categoryId" INTEGER,
  "cardAccountId" INTEGER,
  "payAccountId" INTEGER,
  "accountId" INTEGER,
  "note" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "PersonalTemplate_memberId_idx" ON "PersonalTemplate"("memberId");
ALTER TABLE "PersonalIncome"  ADD COLUMN "templateId" INTEGER;
ALTER TABLE "PersonalExpense" ADD COLUMN "templateId" INTEGER;
ALTER TABLE "PersonalSpend"   ADD COLUMN "templateId" INTEGER;
ALTER TABLE "PersonalPeriod"  ADD COLUMN "planSeededAt" TIMESTAMP(3);
ALTER TABLE "Member"          ADD COLUMN "personalTemplatesAt" TIMESTAMP(3);
