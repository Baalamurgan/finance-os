-- Clear the abandoned "__kept__" note markers from misc Sheet lines.
--
-- Background: an earlier design tagged some planned-misc lines as "kept" (held-in-hand money). That
-- concept was dropped — planned misc are now plain estimated BILLS that show in the Money Plan under
-- their member. A "__kept__" note, however, excludes the line from the bill list (which filters note
-- IS NULL), so tagged lines (e.g. Krishna Jayanthi, Vinayagar chaturthi) never appeared as plan steps.
--
-- This resets those lines to ordinary misc bills. They keep their amount, member, and due day, and
-- will now show as dated bill steps in the Money Plan. Safe & idempotent (only touches __kept__ rows).

UPDATE "ExpenseEntry"
SET "note" = NULL
WHERE "note" = '__kept__';
