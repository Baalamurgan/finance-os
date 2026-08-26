-- MANUAL DATA CLEANUP — apply once, by hand.
--
-- Settlement rows created BEFORE the per-payment migration have key = NULL. Re-ticking an inbound
-- transfer now upserts on the step's key (e.g. "xfer-3-4"), which does NOT match a NULL-key legacy
-- row — so it inserts a SECOND row instead of updating the old one, inflating the pair's paid total.
--
-- Confirmed case: Baala → Arumugam (AUG / period 17) has TWO rows —
--   rec 16 = ₹26,874 (legacy, key NULL, from Aug 1, when the net was 26,874)
--   rec 28 = ₹27,319 (key "xfer-3-4", re-ticked Aug 26, the current net)
-- Summed they read ₹54,193 paid, but Baala only owes ₹27,319. Keep the keyed row, drop the stale one.

DELETE FROM "SettlementRecord" WHERE id = 16;

-- Backfill the remaining legacy INBOUND rows (paid to the treasurer, Arumugam = member 4) with the
-- step key the UI ticks, so a future re-tick updates in place instead of duplicating again. Only one
-- legacy row can exist per pair (the old unique constraint guaranteed it), so this can't collide with
-- another legacy row; the one clash (Baala) is removed above first.
UPDATE "SettlementRecord"
  SET key = 'xfer-' || "fromMemberId" || '-' || "toMemberId"
  WHERE key IS NULL AND "toMemberId" = 4;

-- Verify after — expect Baala→Arumugam to sum to 27,319 and no NULL-key inbound rows remain:
--   SELECT "fromMemberId","toMemberId",SUM(amount),COUNT(*) FROM "SettlementRecord"
--   WHERE "periodId"=17 GROUP BY 1,2;
