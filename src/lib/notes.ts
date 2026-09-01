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
