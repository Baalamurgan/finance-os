-- Fixed-term installments on recurring items (EMIs etc.): repeats N times then stops.
ALTER TABLE "RecurringItem" ADD COLUMN "installmentsTotal" INTEGER;
ALTER TABLE "RecurringItem" ADD COLUMN "installmentStartYear" INTEGER;
ALTER TABLE "RecurringItem" ADD COLUMN "installmentStartMonth" INTEGER;
