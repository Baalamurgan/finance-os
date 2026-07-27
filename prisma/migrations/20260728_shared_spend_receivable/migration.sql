-- Shared-spend receivables: a personal spend split into "I paid X, my share Y" logs the
-- full X and creates a lent PersonalLoan for (X−Y); receiving it posts back as income.
ALTER TABLE "PersonalLoan" ADD COLUMN "sharedPaid" DOUBLE PRECISION;
ALTER TABLE "PersonalLoan" ADD COLUMN "sharedShare" DOUBLE PRECISION;
