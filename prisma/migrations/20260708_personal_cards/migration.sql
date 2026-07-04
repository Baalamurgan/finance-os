-- Personal: credit cards + statement transactions.
CREATE TABLE "PersonalCard" (
    "id" SERIAL NOT NULL,
    "memberId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "bank" TEXT,
    "last4" TEXT,
    "limitAmt" DOUBLE PRECISION,
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PersonalCard_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PersonalCardTxn" (
    "id" SERIAL NOT NULL,
    "memberId" INTEGER NOT NULL,
    "cardId" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "merchant" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'spend',
    "category" TEXT,
    "bucket" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PersonalCardTxn_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PersonalCardTxn_memberId_date_idx" ON "PersonalCardTxn"("memberId", "date");

ALTER TABLE "PersonalCard" ADD CONSTRAINT "PersonalCard_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PersonalCardTxn" ADD CONSTRAINT "PersonalCardTxn_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PersonalCardTxn" ADD CONSTRAINT "PersonalCardTxn_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "PersonalCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
