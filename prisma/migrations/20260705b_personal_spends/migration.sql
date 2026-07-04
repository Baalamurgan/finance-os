-- Personal: split Sheet fixed expenses (label + amount) from categorised Spends.
ALTER TABLE "PersonalExpense" ADD COLUMN "label" TEXT NOT NULL DEFAULT '';
ALTER TABLE "PersonalExpense" ALTER COLUMN "categoryId" DROP NOT NULL;

-- backfill any existing rows' label from their (soon-unused) category name
UPDATE "PersonalExpense" e
SET "label" = c."name"
FROM "PersonalCategory" c
WHERE e."categoryId" = c."id" AND (e."label" IS NULL OR e."label" = '');

CREATE TABLE "PersonalSpend" (
    "id" SERIAL NOT NULL,
    "memberId" INTEGER NOT NULL,
    "periodId" INTEGER NOT NULL,
    "categoryId" INTEGER NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PersonalSpend_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PersonalSpend" ADD CONSTRAINT "PersonalSpend_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PersonalSpend" ADD CONSTRAINT "PersonalSpend_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "PersonalPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PersonalSpend" ADD CONSTRAINT "PersonalSpend_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "PersonalCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
