-- Personal: ad-hoc income + 50/30/20 buckets on categories.
ALTER TABLE "PersonalCategory" ADD COLUMN "bucket" TEXT NOT NULL DEFAULT 'want';

-- sensible defaults (user can reclassify in Setup)
UPDATE "PersonalCategory" SET "bucket" = 'need'
  WHERE "name" IN ('Groceries','Bills & Utilities','Rent','Health','Education','Transport & Fuel');
UPDATE "PersonalCategory" SET "bucket" = 'invest'
  WHERE "name" IN ('Investments');

CREATE TABLE "PersonalIncome" (
    "id" SERIAL NOT NULL,
    "memberId" INTEGER NOT NULL,
    "periodId" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PersonalIncome_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "PersonalIncome" ADD CONSTRAINT "PersonalIncome_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PersonalIncome" ADD CONSTRAINT "PersonalIncome_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "PersonalPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;
