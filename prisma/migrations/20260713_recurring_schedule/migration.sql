-- Generalise recurring items from monthly/installment to any periodicity: an item is DUE
-- when (months since its anchor) is a multiple of intervalMonths. intervalMonths=1 keeps
-- today's behaviour (every month / installment N times). intervalMonths>1 = periodic bills
-- (yearly insurance, every-2-months EMI) that land the full amount only in their due month.
ALTER TABLE "RecurringItem" ADD COLUMN "intervalMonths" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "RecurringItem" ADD COLUMN "dueDay" INTEGER;
