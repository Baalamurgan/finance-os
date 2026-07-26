-- Head-curated quick-add chips for the Add-Spend modal.
CREATE TABLE "SpendShortcut" (
    "id" SERIAL NOT NULL,
    "householdId" INTEGER NOT NULL,
    "icon" TEXT,
    "label" TEXT NOT NULL,
    "categoryId" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SpendShortcut_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SpendShortcut_householdId_idx" ON "SpendShortcut"("householdId");

ALTER TABLE "SpendShortcut" ADD CONSTRAINT "SpendShortcut_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SpendShortcut" ADD CONSTRAINT "SpendShortcut_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
