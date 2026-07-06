-- Reporting-only sub-category tag for miscellaneous (Personal/Misc) spends, so the
-- Analysis breakdown can show where misc money goes (Food, Travel…). Nullable; does
-- not affect settlement, budgets, or any existing value.
ALTER TABLE "Spend" ADD COLUMN "subCategory" TEXT;
