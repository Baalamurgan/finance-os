// Sentinel values written to Period/Income/Expense `note` fields so auto-generated
// lines can be found and replaced (estimate on a draft → final at wind-down) without
// touching the head's hand-entered rows. Shared by actions.ts (draft carry logic) and
// windDown.ts (the close). Keep these in ONE place so a rename can't drift and orphan
// carried lines. See addEstimatedSurplus / addEstimatedCarry / windDownPeriod.

// Auto-generated "Last month surplus" income line (draft estimate → final at wind-down).
export const SURPLUS_NOTE = "__surplus__";
// This month's under-budget leftovers routed to next month's income (opt-in at wind-down).
export const LEFTOVER_NOTE = "__leftover_income__";
// Auto-carried "over-budget excess + misc spends" one-off expense lines.
export const CARRY_NOTE = "__carry__";
// A "deferred" expense: added to the working month DURING its wind-down overhang (calendar
// rolled to the next month but this one isn't wound down yet). A real expense of THIS month
// (shows on the Sheet, counts in totals + carry) but kept OUT of the frozen settlement.
export const DEFERRED_NOTE = "__deferred__";
// A one-off income line created by taking the GENERAL Piggy into this month's spendable income. The
// cash is still physically held by the Piggy holder, so it drives a "holder → treasurer" hand-over
// step (PoolHandover kind "piggy"); the handover amount is re-derived from these lines on add/delete.
export const PIGGY_INCOME_NOTE = "__piggy_income__";
// A misc/unbudgeted expense the family pays from the POOL (treasurer), not the assigned member's own
// cash. The member is a pass-through: the treasurer disburses the FULL amount to them (no payback),
// and they pay the vendor. Kept OUT of the settlement net (the pool bears it, so the member isn't
// debited) and routed through the allowance machinery as a treasurer→member disbursement. Two-step
// variant (a separate member→vendor step is also shown) uses POOL_BILL_NOTE.
export const POOL_NOTE = "__pool__";
export const POOL_BILL_NOTE = "__poolbill__";
// Both pool variants ride the hub: the treasurer disburses to the member. Anything deciding "is this a
// pool-funded line?" MUST cover BOTH — checking only POOL_NOTE was the bug that blocked the treasurer
// from marking a two-step (POOL_BILL_NOTE) disbursement sent. Use this so a new pool note can't be missed.
export function isPoolNote(note: string | null | undefined): boolean {
  return note === POOL_NOTE || note === POOL_BILL_NOTE;
}
// A Setup-generated line (income / recurring expense / budget envelope / bill) the head DELETED for
// this month. Instead of a hard delete we keep the row as a TOMBSTONE (amount 0, pinned, oneOff so a
// rebuild's clearGeneratedRows won't wipe it) so the removal is a persistent, intentional override:
// generateMonth skips recreating that source, and the Sheet shows it struck-through with a Restore
// button. Amount 0 keeps every total/settlement correct automatically; it's only hidden from the rows
// that render a live line. Restoring hard-deletes the tombstone so the next sync/rebuild regenerates it.
export const REMOVED_NOTE = "__removed__";
