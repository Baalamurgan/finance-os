-- Net-worth holdings: manually-valued assets & liabilities (stocks, MF, FD, PF, gold,
-- property, land, loans…). Net worth also folds in credit-card outstanding + open
-- lending/borrowing, which live in their own tables (not duplicated here).
CREATE TABLE "NetWorthItem" (
  "id"          SERIAL PRIMARY KEY,
  "memberId"    INTEGER NOT NULL REFERENCES "Member"("id") ON DELETE CASCADE,
  "category"    TEXT NOT NULL,
  "type"        TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "value"       DOUBLE PRECISION NOT NULL,
  "quantity"    DOUBLE PRECISION,
  "institution" TEXT,
  "notes"       TEXT,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "NetWorthItem_memberId_idx" ON "NetWorthItem"("memberId");
