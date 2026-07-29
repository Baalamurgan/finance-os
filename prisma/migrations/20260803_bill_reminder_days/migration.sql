-- Per-bill reminder lead time for family bills (mirrors CreditCardDetail.reminderDays).
ALTER TABLE "Category" ADD COLUMN "reminderDays" INTEGER;
