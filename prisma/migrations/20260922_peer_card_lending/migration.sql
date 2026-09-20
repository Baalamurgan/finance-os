-- Peer-card lending: repay-by reminders + cross-member card usage.
-- New columns on PersonalLoan; back-relation to FinanceAccount is relation-only (no SQL).
ALTER TABLE "PersonalLoan" ADD COLUMN "dueDate" TIMESTAMP(3);
ALTER TABLE "PersonalLoan" ADD COLUMN "notifyDaysBefore" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "PersonalLoan" ADD COLUMN "linkGroup" TEXT;
ALTER TABLE "PersonalLoan" ADD COLUMN "cardAccountId" INTEGER;

CREATE INDEX "PersonalLoan_linkGroup_idx" ON "PersonalLoan"("linkGroup");

ALTER TABLE "PersonalLoan"
  ADD CONSTRAINT "PersonalLoan_cardAccountId_fkey"
  FOREIGN KEY ("cardAccountId") REFERENCES "FinanceAccount"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
