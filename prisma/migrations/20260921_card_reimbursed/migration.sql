-- A card whose spends aren't family cash now — reimbursed at the next settlement (credit cards, or a
-- benefit wallet like Pluxee). When true, spends are excluded from In-Hand and shown as "settles next month".
ALTER TABLE "FinanceAccount" ADD COLUMN "reimbursed" BOOLEAN NOT NULL DEFAULT false;
