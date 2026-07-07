import { currentCycle } from "./cycle";
import { OWED_UP, OWED_DOWN, type CreditDashboard, type LedgerTxn } from "./types";

/**
 * Pure, deterministic credit-card dashboard. Computes ONLY from confirmed ledger rows +
 * card config — no AI, no side effects. Missing config (limit / statement day) yields
 * nulls + `hasLimit`/`hasCycle` flags so the UI can prompt instead of showing NaN.
 *
 * outstanding = running balance owed across ALL txns (owed-up minus owed-down).
 * "this cycle" figures use only txns inside the in-progress cycle window.
 */
export function computeCreditDashboard(input: {
  creditLimit?: number | null;
  statementDay?: number | null;
  dueOffsetDays?: number | null;
  txns: LedgerTxn[];
  now?: Date;
}): CreditDashboard {
  const { creditLimit, statementDay, dueOffsetDays, txns } = input;
  const now = input.now ?? new Date();

  let outstanding = 0;
  let lifetimeCashback = 0;
  let lifetimePoints = 0;
  for (const t of txns) {
    if (OWED_UP.has(t.type)) outstanding += t.amount;
    else if (OWED_DOWN.has(t.type)) outstanding -= t.amount;
    if (t.type === "cashback") lifetimeCashback += t.amount;
    if (t.rewardPoints) lifetimePoints += t.rewardPoints;
  }

  const hasLimit = creditLimit != null && creditLimit > 0;
  const available = hasLimit ? creditLimit! - outstanding : null;
  const utilPct = hasLimit ? (outstanding / creditLimit!) * 100 : null;

  const hasCycle = statementDay != null;
  const cycle = hasCycle ? currentCycle(statementDay!, now, dueOffsetDays) : null;

  let spentThisCycle = 0;
  let paymentsThisCycle = 0;
  let cashbackThisCycle = 0;
  let pointsThisCycle = 0;
  if (cycle) {
    const lo = cycle.start.getTime();
    // include the whole statement day (end-of-day)
    const hi = new Date(cycle.end.getFullYear(), cycle.end.getMonth(), cycle.end.getDate(), 23, 59, 59, 999).getTime();
    for (const t of txns) {
      const ts = t.date.getTime();
      if (ts < lo || ts > hi) continue;
      if (t.type === "spend") spentThisCycle += t.amount;
      else if (t.type === "payment") paymentsThisCycle += t.amount;
      else if (t.type === "cashback") cashbackThisCycle += t.amount;
      if (t.rewardPoints) pointsThisCycle += t.rewardPoints;
    }
  }

  return {
    outstanding,
    hasLimit,
    available,
    utilPct,
    hasCycle,
    cycle,
    spentThisCycle,
    paymentsThisCycle,
    cashbackThisCycle,
    pointsThisCycle,
    lifetimeCashback,
    lifetimePoints,
  };
}
