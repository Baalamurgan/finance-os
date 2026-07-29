-- A single shared family note (behind the app lock), editable by any member.
ALTER TABLE "Household" ADD COLUMN "notes" TEXT;
ALTER TABLE "Household" ADD COLUMN "notesUpdatedAt" TIMESTAMP(3);
ALTER TABLE "Household" ADD COLUMN "notesUpdatedById" INTEGER;
