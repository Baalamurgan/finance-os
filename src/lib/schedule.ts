// Recurring-item scheduling (pure, dependency-free → unit-testable and client-safe).
//
// An item is anchored by (installmentStartYear, installmentStartMonth) and repeats every
// `intervalMonths`. It is DUE in a target month when the number of whole months since the
// anchor is a non-negative multiple of the interval, and (if capped) within the occurrence
// count. No anchor = plain "every month".
//
//   every month  → start = null                       (interval ignored)
//   installment  → interval 1, start set, total = N    (EMI: N consecutive months)
//   periodic     → interval N (2/6/12…), start = first-due month, total = null | N

export type Schedule = {
  intervalMonths?: number | null;
  installmentsTotal?: number | null; // occurrence cap (null = forever)
  installmentStartYear?: number | null;
  installmentStartMonth?: number | null;
};

/** Is this item due in the given month, and if so which occurrence number (1-based)? */
export function scheduleOccurrence(
  sched: Schedule,
  period: { year: number; month: number },
): { due: boolean; n: number | null } {
  const sy = sched.installmentStartYear;
  const sm = sched.installmentStartMonth;
  if (sy == null || sm == null) return { due: true, n: null }; // no anchor → every month
  const interval = Math.max(1, Math.round(sched.intervalMonths ?? 1));
  const delta = (period.year - sy) * 12 + (period.month - sm); // whole months since anchor
  if (delta < 0) return { due: false, n: null }; // before it starts
  if (delta % interval !== 0) return { due: false, n: null }; // not a due month
  const n = delta / interval + 1;
  if (sched.installmentsTotal != null && n > sched.installmentsTotal) return { due: false, n }; // past the last one
  return { due: true, n };
}

/** The generated line label — "name N/total" for capped runs, plain name otherwise. */
export function scheduleLabel(name: string, total: number | null | undefined, n: number | null): string {
  return total != null && n != null ? `${name} ${n}/${total}` : name;
}

/**
 * Is a "full bill on due month" category due in this month? The bill recurs every
 * `everyMonths` (a divisor of 12: 2/3/4/6/12) anchored to `billMonth`, so it's due when
 * the month-of-year offset from the anchor is a multiple of the cycle. Year-agnostic —
 * the pattern repeats each year (e.g. yearly-July → every July; every-2-months-Aug →
 * Aug, Oct, Dec, Feb, Apr, Jun).
 */
export function isLumpDue(billMonth: number, everyMonths: number, period: { month: number }): boolean {
  const c = Math.max(1, Math.round(everyMonths));
  return ((((period.month - billMonth) % c) + c) % c) === 0;
}

/** Months from `month` to the NEXT due month (≥1). Only meaningful in a non-due month. */
export function monthsUntilNextDue(billMonth: number, everyMonths: number, month: number): number {
  const c = Math.max(1, Math.round(everyMonths));
  const k = (((billMonth - month) % c) + c) % c; // 0 = due this month
  return k === 0 ? c : k; // in a saving month k∈[1,c-1]; guard 0 → a full cycle away
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/**
 * Where `month` sits inside a periodic bill's half-yearly (or N-monthly) cycle anchored at `billMonth`.
 * `monthsIntoCycle` is 0 on the due month (the cycle START — the early-payment window) and `everyMonths−1`
 * on the DEADLINE month (the last month to pay before it rolls / goes overdue). E.g. property every-6,
 * billMonth Oct: Oct→0 (window), Nov→1, …, Mar→5 (deadline). Year-agnostic, like isLumpDue.
 */
export function billCyclePhase(billMonth: number, everyMonths: number, month: number): {
  monthsIntoCycle: number;
  isDueMonth: boolean;      // the cycle's start = the early-payment window month
  isDeadlineMonth: boolean; // the cycle's last month = pay-by deadline
} {
  const c = Math.max(1, Math.round(everyMonths));
  const monthsIntoCycle = (((month - billMonth) % c) + c) % c;
  return { monthsIntoCycle, isDueMonth: monthsIntoCycle === 0, isDeadlineMonth: monthsIntoCycle === c - 1 };
}

export type BillDuePhase = "incentive" | "normal" | "overdue";
/**
 * Amount actually due for a periodic bill, honouring an early-payment incentive and a late penalty —
 * the property/water-tax model. Both knobs are optional (null ⇒ a plain bill, always `billAmount`):
 *   • `inIncentiveWindow` + `earlyAmount` set ⇒ the discounted `earlyAmount` (phase "incentive").
 *   • `monthsLate > 0` + `latePenaltyPct` set ⇒ `billAmount` + SIMPLE `latePenaltyPct`%/month on the FULL
 *     amount (non-compounding), i.e. billAmount·(1 + pct/100·monthsLate) (phase "overdue").
 *   • otherwise the full `billAmount` (phase "normal").
 * `earlyAmount` is stored explicitly (the real incentive isn't a clean % of the bill), so no % guesswork.
 */
export function billDueAmount(input: {
  billAmount: number;
  earlyAmount?: number | null;
  latePenaltyPct?: number | null;
  monthsLate?: number;         // months past the cycle deadline (0 ⇒ on time / still within the cycle)
  inIncentiveWindow?: boolean; // paying within the early-payment window (first 30 days of the due month)
}): { amount: number; phase: BillDuePhase } {
  const { billAmount, earlyAmount, latePenaltyPct, monthsLate = 0, inIncentiveWindow = false } = input;
  if (monthsLate > 0 && latePenaltyPct != null && latePenaltyPct > 0) {
    return { amount: round2(billAmount * (1 + (latePenaltyPct / 100) * monthsLate)), phase: "overdue" };
  }
  if (inIncentiveWindow && earlyAmount != null) {
    return { amount: round2(earlyAmount), phase: "incentive" };
  }
  return { amount: round2(billAmount), phase: "normal" };
}

export type FundingStyle = "auto" | "fixed" | "none";

// What a "bill with a fund" category does in a given month (pure — no side effects).
//  • auto, save-cadence month  → set aside (bill − fund) × cadence ÷ months-left (self-correcting)
//  • auto, due month           → set aside a normal share (fund treated as reset by the payment);
//                                the full bill is NOT a Sheet line — it's paid from the fund in In Hand
//  • auto, off-cadence month   → nothing
//  • fixed                     → set aside the user's fixed share (every month)
//  • none, due month           → the full bill lands as a Sheet expense (fund, if any, credits it)
//  • none, other month         → nothing
//
// `saveEveryMonths` (S, default 1) is the save cadence: auto sets aside only on months whose
// distance to the due month is a multiple of S, and each contribution is scaled so the fund
// still fills exactly by the due month. S = 1 reproduces the plain monthly self-correcting save.
export type BillMonthPlan =
  | { kind: "bill"; bill: number; fromFund: number; outOfPocket: number }
  | { kind: "save"; contribution: number }
  | { kind: "none" };

export function planBillMonth(input: {
  billAmount: number;
  billMonth: number;
  everyMonths: number;
  fund: number;
  fundingStyle: FundingStyle;
  fixedShare?: number | null;
  saveEveryMonths?: number | null;
  month: number;
}): BillMonthPlan {
  const { billAmount, billMonth, everyMonths, fund, fundingStyle, fixedShare, saveEveryMonths, month } = input;
  const due = isLumpDue(billMonth, everyMonths, { month });

  // pay-in-full: the whole bill lands as a Sheet expense on its due month (a fund, if any, credits it)
  if (fundingStyle === "none") {
    if (!due) return { kind: "none" };
    const fromFund = Math.max(0, Math.min(fund, billAmount));
    return { kind: "bill", bill: billAmount, fromFund, outOfPocket: Math.round((billAmount - fromFund) * 100) / 100 };
  }

  // save-the-share (auto / legacy fixed): a set-aside EVERY month, INCLUDING the due month. The
  // full bill is never a Sheet line here — it's paid from the fund in the In Hand tab.
  const S = Math.max(1, Math.round(saveEveryMonths ?? 1));
  if (due) {
    // Due month (auto): set aside exactly what's still needed to bring the fund UP TO the bill, so the
    // fund always covers it. A skipped/short save is made up here — the share RISES to fill the gap; a
    // fully-funded fund needs nothing (0); and in the normal on-track case the fund is one share short,
    // so this equals the usual share. `fixed` keeps its flat user-set share every month, due included.
    const share = fundingStyle === "fixed" ? Math.max(0, fixedShare ?? 0) : Math.max(0, billAmount - fund);
    return { kind: "save", contribution: Math.round(share * 100) / 100 };
  }
  if (fundingStyle === "fixed") return { kind: "save", contribution: Math.max(0, fixedShare ?? 0) };
  const left = monthsUntilNextDue(billMonth, everyMonths, month); // 1..everyMonths-1 in saving months
  if (left % S !== 0) return { kind: "none" }; // not a save-cadence month
  const remaining = Math.max(0, billAmount - fund);
  // Cadence saves from now (inclusive) through the DUE month inclusive — the +1 is the due
  // month's own share, which also goes toward paying the bill (the fund fills ON the due
  // month, not before it). Keeps shares small & flat instead of front-loading near the due date.
  const savesLeft = left / S + 1;
  return { kind: "save", contribution: Math.round((remaining / savesLeft) * 100) / 100 };
}

export type TaxCyclePhase = "window" | "share" | "deadline" | "overdue";
/**
 * One month of a tax bill's half-yearly cycle, the "Both" model (see property/water tax):
 *  • WINDOW month (cycle start, monthsIntoCycle 0): pay the WHOLE bill early at `earlyAmount` (💰), or skip.
 *  • SHARE months (1 … everyMonths−2): if the window was skipped, the bill spreads over the months LEFT —
 *    `(billAmount − saved) ÷ (everyMonths − monthsIntoCycle)`. Skipping a share re-spreads over fewer months,
 *    so the next share RISES (₹1000/5→200 at Nov, →1000/4=250 at Dec if Nov skipped).
 *  • DEADLINE month (everyMonths−1): the last share = the whole remaining (🧾 BILL).
 *  • OVERDUE (≥ everyMonths, carried into the next cycle): remaining × (1 + latePenaltyPct%·monthsLate), SIMPLE.
 * `saved` is what's already been set aside into this cycle's pot (paid shares). Returns the amount to show/pay
 * THIS month and its phase; amount 0 ⇒ nothing left to pay (already fully funded).
 */
export function taxCycleMonth(input: {
  billAmount: number;
  earlyAmount?: number | null;
  latePenaltyPct?: number | null;
  everyMonths: number;
  monthsIntoCycle: number; // 0 = window … everyMonths−1 = deadline … ≥ everyMonths = overdue
  saved?: number;          // already set aside into this cycle's pot
}): { phase: TaxCyclePhase; amount: number } {
  const { billAmount, earlyAmount, latePenaltyPct, everyMonths, monthsIntoCycle } = input;
  const E = Math.max(1, Math.round(everyMonths));
  const saved = Math.max(0, input.saved ?? 0);
  const remaining = Math.max(0, round2(billAmount - saved));
  if (monthsIntoCycle <= 0) {
    // Window: pay the whole bill early at the incentive price (discount off the FULL bill).
    return { phase: "window", amount: round2(earlyAmount ?? billAmount) };
  }
  if (monthsIntoCycle >= E) {
    // Overdue — simple penalty on what's still owed, per month past the deadline.
    const monthsLate = monthsIntoCycle - (E - 1);
    const pct = latePenaltyPct ?? 0;
    return { phase: "overdue", amount: round2(remaining * (1 + (pct / 100) * monthsLate)) };
  }
  // Share months (incl. the deadline month, where monthsLeft = 1 ⇒ the whole remaining).
  const monthsLeft = E - monthsIntoCycle; // Nov=5 … Mar=1
  const share = round2(remaining / monthsLeft);
  return { phase: monthsIntoCycle === E - 1 ? "deadline" : "share", amount: share };
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Short human summary of a PERIODIC schedule (interval>1), else null. Installments are
 *  shown separately as their "N/total" tag. e.g. "yearly · 1 Jul", "every 2 months". */
export function scheduleSummary(s: {
  intervalMonths?: number | null;
  installmentStartMonth?: number | null;
  dueDay?: number | null;
}): string | null {
  const iv = s.intervalMonths ?? 1;
  if (iv <= 1) return null;
  const every =
    iv === 12 ? "yearly" : iv === 6 ? "half-yearly" : iv === 3 ? "quarterly" : iv === 2 ? "every 2 months" : `every ${iv} mo`;
  const mon = s.installmentStartMonth ? MON[s.installmentStartMonth - 1] : null;
  const day = s.dueDay ? `${s.dueDay} ` : "";
  return mon ? `${every} · ${day}${mon}` : every;
}
