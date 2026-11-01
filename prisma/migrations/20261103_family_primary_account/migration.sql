-- FinanceAccount.familyPrimary: the member's account that holds their family In-Hand (at most one per member,
-- enforced in code). Nullable-safe add with a false default.
ALTER TABLE "FinanceAccount" ADD COLUMN "familyPrimary" BOOLEAN NOT NULL DEFAULT false;
