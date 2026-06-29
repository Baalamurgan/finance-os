-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Household" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'family',
    "treasurerMemberId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Household_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Loan" (
    "id" SERIAL NOT NULL,
    "householdId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'loan',
    "outstanding" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "monthlyAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "memberId" INTEGER,
    "totalInstallments" INTEGER,
    "paidInstallments" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Loan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoanPayment" (
    "id" SERIAL NOT NULL,
    "loanId" INTEGER NOT NULL,
    "periodId" INTEGER,
    "amount" DOUBLE PRECISION NOT NULL,
    "principalPart" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoanPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Member" (
    "id" SERIAL NOT NULL,
    "householdId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "email" TEXT,
    "isEarner" BOOLEAN NOT NULL DEFAULT true,
    "role" TEXT NOT NULL DEFAULT 'member',

    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Period" (
    "id" SERIAL NOT NULL,
    "householdId" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "treasurerMemberId" INTEGER,
    "carryForward" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "movedToPiggy" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "Period_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PiggyEntry" (
    "id" SERIAL NOT NULL,
    "householdId" INTEGER NOT NULL,
    "periodId" INTEGER,
    "categoryId" INTEGER,
    "kind" TEXT NOT NULL DEFAULT 'piggy',
    "amount" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PiggyEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" SERIAL NOT NULL,
    "householdId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'expense',
    "section" TEXT NOT NULL DEFAULT 'Monthly',
    "necessary" BOOLEAN NOT NULL DEFAULT true,
    "tracked" BOOLEAN NOT NULL DEFAULT false,
    "monthlyBudget" DOUBLE PRECISION,
    "sinking" BOOLEAN NOT NULL DEFAULT false,
    "cycleMonths" INTEGER,
    "onHold" BOOLEAN NOT NULL DEFAULT false,
    "responsibleMemberId" INTEGER,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncomeEntry" (
    "id" SERIAL NOT NULL,
    "periodId" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "ownerId" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncomeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseEntry" (
    "id" SERIAL NOT NULL,
    "periodId" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "categoryId" INTEGER NOT NULL,
    "memberId" INTEGER,
    "necessary" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpenseEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Spend" (
    "id" SERIAL NOT NULL,
    "periodId" INTEGER NOT NULL,
    "categoryId" INTEGER NOT NULL,
    "memberId" INTEGER,
    "label" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "imagePath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Spend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementRecord" (
    "id" SERIAL NOT NULL,
    "householdId" INTEGER NOT NULL,
    "periodId" INTEGER NOT NULL,
    "fromMemberId" INTEGER NOT NULL,
    "toMemberId" INTEGER NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "settledById" INTEGER,
    "settledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettlementRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Budget" (
    "id" SERIAL NOT NULL,
    "periodId" INTEGER NOT NULL,
    "categoryId" INTEGER NOT NULL,
    "planned" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Member_email_key" ON "Member"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Member_householdId_code_key" ON "Member"("householdId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Period_householdId_year_month_key" ON "Period"("householdId", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "Category_householdId_name_key" ON "Category"("householdId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementRecord_periodId_fromMemberId_toMemberId_key" ON "SettlementRecord"("periodId", "fromMemberId", "toMemberId");

-- CreateIndex
CREATE UNIQUE INDEX "Budget_periodId_categoryId_key" ON "Budget"("periodId", "categoryId");

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanPayment" ADD CONSTRAINT "LoanPayment_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Period" ADD CONSTRAINT "Period_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PiggyEntry" ADD CONSTRAINT "PiggyEntry_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PiggyEntry" ADD CONSTRAINT "PiggyEntry_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "Period"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PiggyEntry" ADD CONSTRAINT "PiggyEntry_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncomeEntry" ADD CONSTRAINT "IncomeEntry_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "Period"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncomeEntry" ADD CONSTRAINT "IncomeEntry_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseEntry" ADD CONSTRAINT "ExpenseEntry_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "Period"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseEntry" ADD CONSTRAINT "ExpenseEntry_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseEntry" ADD CONSTRAINT "ExpenseEntry_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Spend" ADD CONSTRAINT "Spend_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "Period"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Spend" ADD CONSTRAINT "Spend_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Spend" ADD CONSTRAINT "Spend_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementRecord" ADD CONSTRAINT "SettlementRecord_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementRecord" ADD CONSTRAINT "SettlementRecord_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "Period"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "Period"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

