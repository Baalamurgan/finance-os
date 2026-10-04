-- Pay a fund/periodic bill on a credit card: remember which card, and link the 1:1 mirror
-- ledger line that puts the charge on that card's statement (parallel to familySpendId).
ALTER TABLE "BillPayment" ADD COLUMN "cardAccountId" INTEGER;

ALTER TABLE "AccountTransaction" ADD COLUMN "billPaymentId" INTEGER;
CREATE UNIQUE INDEX "AccountTransaction_billPaymentId_key" ON "AccountTransaction"("billPaymentId");
ALTER TABLE "AccountTransaction"
  ADD CONSTRAINT "AccountTransaction_billPaymentId_fkey"
  FOREIGN KEY ("billPaymentId") REFERENCES "BillPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
