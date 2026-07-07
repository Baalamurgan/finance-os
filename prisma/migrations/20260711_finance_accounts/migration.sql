-- Finance (Wallet) foundation. Replaces the 0-row PersonalCard/PersonalCardTxn with a
-- typed FinanceAccount base + CreditCardDetail specialization + a generic
-- AccountTransaction ledger, so future account types (bank/loan/investment) extend cleanly.

DROP TABLE IF EXISTS "PersonalCardTxn";
DROP TABLE IF EXISTS "PersonalCard";

CREATE TABLE "FinanceAccount" (
  "id"          SERIAL PRIMARY KEY,
  "memberId"    INTEGER NOT NULL REFERENCES "Member"("id") ON DELETE CASCADE,
  "type"        TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "institution" TEXT,
  "network"     TEXT,
  "last4"       TEXT,
  "color"       TEXT NOT NULL DEFAULT '#6366f1',
  "active"      BOOLEAN NOT NULL DEFAULT true,
  "sortOrder"   INTEGER NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "FinanceAccount_memberId_idx" ON "FinanceAccount"("memberId");

CREATE TABLE "CreditCardDetail" (
  "id"            SERIAL PRIMARY KEY,
  "accountId"     INTEGER NOT NULL UNIQUE REFERENCES "FinanceAccount"("id") ON DELETE CASCADE,
  "creditLimit"   DOUBLE PRECISION,
  "statementDay"  INTEGER,
  "dueOffsetDays" INTEGER
);

CREATE TABLE "AccountTransaction" (
  "id"           SERIAL PRIMARY KEY,
  "memberId"     INTEGER NOT NULL REFERENCES "Member"("id") ON DELETE CASCADE,
  "accountId"    INTEGER NOT NULL REFERENCES "FinanceAccount"("id") ON DELETE CASCADE,
  "date"         TIMESTAMP(3) NOT NULL,
  "merchant"     TEXT NOT NULL,
  "amount"       DOUBLE PRECISION NOT NULL,
  "type"         TEXT NOT NULL DEFAULT 'spend',
  "rewardPoints" DOUBLE PRECISION,
  "category"     TEXT,
  "bucket"       TEXT,
  "confidence"   DOUBLE PRECISION,
  "needsReview"  BOOLEAN NOT NULL DEFAULT false,
  "source"       TEXT NOT NULL DEFAULT 'manual',
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "AccountTransaction_memberId_date_idx" ON "AccountTransaction"("memberId", "date");
CREATE INDEX "AccountTransaction_accountId_date_idx" ON "AccountTransaction"("accountId", "date");
