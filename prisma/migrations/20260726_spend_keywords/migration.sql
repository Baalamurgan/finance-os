-- Learned item→category memory for the Add-Spend nudge (seed knowledge is in code).
CREATE TABLE "SpendKeyword" (
    "id" SERIAL NOT NULL,
    "householdId" INTEGER NOT NULL,
    "keyword" TEXT NOT NULL,
    "categoryId" INTEGER NOT NULL,
    "hits" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SpendKeyword_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SpendKeyword_householdId_keyword_key" ON "SpendKeyword"("householdId", "keyword");
CREATE INDEX "SpendKeyword_householdId_idx" ON "SpendKeyword"("householdId");

ALTER TABLE "SpendKeyword" ADD CONSTRAINT "SpendKeyword_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SpendKeyword" ADD CONSTRAINT "SpendKeyword_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
