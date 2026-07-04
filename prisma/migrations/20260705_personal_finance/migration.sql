-- Personal finance mode: per-member private space + separate lock. Additive only.
ALTER TABLE "Member" ADD COLUMN "personalPinHash" TEXT;
ALTER TABLE "Member" ADD COLUMN "personalPinSalt" TEXT;
ALTER TABLE "Member" ADD COLUMN "personalPinFailedAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Member" ADD COLUMN "personalPinLockedUntil" TIMESTAMP(3);
ALTER TABLE "Member" ADD COLUMN "personalWindDownDay" INTEGER;
ALTER TABLE "Member" ADD COLUMN "personalOnboarded" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "WebAuthnCredential" ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'family';

CREATE TABLE "PersonalCategory" (
    "id" SERIAL NOT NULL,
    "memberId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PersonalCategory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PersonalCategory_memberId_name_key" ON "PersonalCategory"("memberId", "name");

CREATE TABLE "PersonalPeriod" (
    "id" SERIAL NOT NULL,
    "memberId" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "income" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PersonalPeriod_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PersonalPeriod_memberId_year_month_key" ON "PersonalPeriod"("memberId", "year", "month");

CREATE TABLE "PersonalExpense" (
    "id" SERIAL NOT NULL,
    "memberId" INTEGER NOT NULL,
    "periodId" INTEGER NOT NULL,
    "categoryId" INTEGER NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recurring" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PersonalExpense_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PersonalLoan" (
    "id" SERIAL NOT NULL,
    "memberId" INTEGER NOT NULL,
    "direction" TEXT NOT NULL,
    "counterparty" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "outstanding" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PersonalLoan_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PersonalCategory" ADD CONSTRAINT "PersonalCategory_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PersonalPeriod" ADD CONSTRAINT "PersonalPeriod_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PersonalExpense" ADD CONSTRAINT "PersonalExpense_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PersonalExpense" ADD CONSTRAINT "PersonalExpense_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "PersonalPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PersonalExpense" ADD CONSTRAINT "PersonalExpense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "PersonalCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PersonalLoan" ADD CONSTRAINT "PersonalLoan_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
