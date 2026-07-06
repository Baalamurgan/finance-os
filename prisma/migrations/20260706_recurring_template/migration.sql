-- Recurring template (source of truth for what repeats each month).
CREATE TABLE "RecurringItem" (
    "id" SERIAL NOT NULL,
    "householdId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "categoryId" INTEGER,
    "memberId" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecurringItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RecurringItem_householdId_idx" ON "RecurringItem"("householdId");
