-- Per-card reminder lead time: how many days before a card's due date the reminder fires.
ALTER TABLE "CreditCardDetail" ADD COLUMN "reminderDays" INTEGER;
