-- Head-editable sub-category tags for family "Personal/Misc" spends (reporting-only).
-- A household with no rows falls back to the built-in defaults in code; the first add/remove
-- materialises those defaults into rows (handled in the app), after which this table drives the list.

CREATE TABLE "MiscCategory" (
  "id"          SERIAL PRIMARY KEY,
  "householdId" INTEGER NOT NULL,
  "name"        TEXT NOT NULL,
  "icon"        TEXT,
  "sortOrder"   INTEGER NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MiscCategory_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "MiscCategory_householdId_name_key" ON "MiscCategory" ("householdId", "name");
CREATE INDEX "MiscCategory_householdId_sortOrder_idx" ON "MiscCategory" ("householdId", "sortOrder");
