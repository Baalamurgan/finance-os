-- A bill-with-a-fund can be SAVED/held by one member (responsibleMemberId) and PAID by
-- another on its due month (payerMemberId). Null payer → the saver also pays.
ALTER TABLE "Category" ADD COLUMN "payerMemberId" INTEGER;
