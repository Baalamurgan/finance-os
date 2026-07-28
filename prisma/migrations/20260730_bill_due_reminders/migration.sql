-- Bill-due reminder toggles: household master switch + per-bill opt-out.
ALTER TABLE "Household" ADD COLUMN "billRemindersOn" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Category" ADD COLUMN "remind" BOOLEAN NOT NULL DEFAULT true;
