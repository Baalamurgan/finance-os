-- Optional annual/joining fee on a credit card. When a bill's cycle month matches annualFeeMonth,
-- the card-bill total auto-adds annualFee on top of the summed swipes.
ALTER TABLE "CreditCardDetail" ADD COLUMN "annualFee" DOUBLE PRECISION;
ALTER TABLE "CreditCardDetail" ADD COLUMN "annualFeeMonth" INTEGER;
