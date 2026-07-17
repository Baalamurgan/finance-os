-- Portion of a due-month bill covered by THIS month's own set-aside (cancels its
-- wind-down accrual instead of drawing the fund negative).
ALTER TABLE "BillPayment" ADD COLUMN "fromSetAside" DOUBLE PRECISION NOT NULL DEFAULT 0;
