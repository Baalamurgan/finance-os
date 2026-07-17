-- Per-bill overdue behaviour for a bill-with-a-fund: "carry" (unpaid share stays in the
-- fund and nags in next month's In-Hand) | "skip" (subscription: release the held share
-- back to general Piggy at wind-down).
ALTER TABLE "Category" ADD COLUMN "onUnpaid" TEXT NOT NULL DEFAULT 'carry';
