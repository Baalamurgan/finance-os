// Payment-prioritization engine — the "cost of waiting" model.
//
// When a month's money can't cover everything, this ranks every payable on ONE scale:
// how many ₹ it costs you to NOT pay it this month. A home-loan EMI, a jewel loan, a
// property-tax penalty — all reduced to the same "cost of waiting", so the balance flows
// into the most expensive-to-skip items first.
//
// Two tiers:
//   • mandatory  — paid first, in listed order (rent, EMIs; default/eviction risk). A tiny
//                  interest number must never out-rank rent, so mandatory is NOT re-sorted
//                  by cost; the caller lists them in importance order.
//   • deferrable — ranked by the caller's chosen column (efficiency OR absolute cost) and
//                  filled with whatever balance is left.
//
// Pure: no DB, no I/O, no dates. The data assembly (loans + tax bills → Payable[]) lives in
// the query; the page passes the typed balance + sort choice + overrides. Money is Float
// across the app; we round2 (half-up) at the boundaries and never compare floats with ==.

export type PayableTier = "mandatory" | "deferrable";

export type PayableKind =
  | "loan_emi" // reducing-balance loan with a monthly EMI — mandatory by default
  | "loan_interest" // interest-only / jewel loan — reduce principal; deferrable by default
  | "chit" // chit installment — mandatory by default
  | "tax_window" // tax inside its incentive window — lose the discount if deferred (one-time)
  | "tax_due" // tax at/after deadline — penalty accrues each month (recurring)
  | "tax_share" // tax monthly set-aside share — no penalty yet (deferrable, ~0 cost)
  | "bill" // ordinary obligation (rent / EB / …) — mandatory by default, 0 cost
  | "prepay"; // optional extra principal toward a loan — deferrable

export interface Payable {
  /** Stable key for override lookups & React keys, e.g. "loan:7", "cat:33". */
  id: string;
  label: string;
  kind: PayableKind;
  /** ₹ this item can absorb this month: an EMI/bill due, or `outstanding` for a divisible loan. */
  amount: number;
  /** Can a PARTIAL payment help? Loans yes (any ₹ cuts interest); whole bills/taxes no. */
  divisible: boolean;
  /** Auto-derived tier before any user override. */
  mandatoryDefault: boolean;
  /** Loan interest rate (annual %). Drives the cost for rate-based divisible items. */
  annualRatePct?: number | null;
  /** Explicit recurring ₹/month cost of waiting (e.g. a tax penalty). */
  monthlyCost?: number | null;
  /** Explicit ONE-TIME ₹ cost if a window passes (e.g. a forfeited tax incentive). */
  oneTimeCost?: number | null;
  /** Optional sub-label for display, e.g. "₹1,00,000 @ 18%". */
  sub?: string | null;
}

export interface RankInput {
  payables: Payable[];
  /** The number the user typed — money available to deploy this month. */
  balance: number;
  /** Which column drives the deferrable allocation (both are always computed & shown). */
  sortBy: "efficiency" | "cost";
  /** Per-id tier override (localStorage on the page); absent ⇒ use mandatoryDefault. */
  overrides?: Record<string, PayableTier>;
}

export interface RankedPayable {
  id: string;
  label: string;
  kind: PayableKind;
  sub?: string | null;
  amount: number;
  divisible: boolean;
  /** Tier AFTER applying any override. */
  tier: PayableTier;
  /** True when the tier differs from `mandatoryDefault` (i.e. the user flipped it). */
  overridden: boolean;
  annualRatePct?: number | null;
  /** ₹ it costs to skip this item — for one month (recurring) or once (window). */
  costOfWaiting: number;
  /** Is `costOfWaiting` a monthly recurring figure (true) or a one-time forfeit (false)? */
  recurring: boolean;
  /** ₹ saved per ₹100 paid = costOfWaiting / amount × 100 (the avalanche metric). */
  efficiency: number;
  /** ₹ the plan assigns to this item. */
  allocated: number;
  verdict: "pay" | "partial" | "defer";
  /** ₹ cost incurred because (the unpaid part of) this item was deferred. */
  deferredCost: number;
}

export interface RankResult {
  balance: number;
  /** Tier 1, in the order paid (= listed order). */
  mandatory: RankedPayable[];
  /** Tier 2, ranked by the chosen `sortBy`, descending. */
  deferrable: RankedPayable[];
  mandatoryTotal: number;
  /** ₹ actually allocated across both tiers (≤ balance). */
  spent: number;
  /** ₹ left unspent (≥ 0). */
  leftover: number;
  /** ₹ of mandatory obligations the balance could NOT cover (>0 ⇒ a real problem). */
  shortfall: number;
  /** ₹ of cost-of-waiting killed by what we paid. */
  penaltyAvoided: number;
  /** ₹ of cost-of-waiting incurred by what we deferred (= Σ deferredCost). */
  penaltyIncurred: number;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/** The cost of skipping a payable for a month, and whether that cost recurs. */
function costOf(p: Payable): { cost: number; recurring: boolean } {
  // Rate-based divisible loans: the cost scales with the amount (interest on the balance).
  if (p.divisible && p.annualRatePct != null && p.annualRatePct > 0) {
    return { cost: round2((p.amount * p.annualRatePct) / 1200), recurring: true };
  }
  if (p.oneTimeCost != null) return { cost: round2(p.oneTimeCost), recurring: false };
  if (p.monthlyCost != null) return { cost: round2(p.monthlyCost), recurring: true };
  if (p.annualRatePct != null && p.annualRatePct > 0) {
    return { cost: round2((p.amount * p.annualRatePct) / 1200), recurring: true };
  }
  return { cost: 0, recurring: true };
}

interface Priced extends Payable {
  tier: PayableTier;
  overridden: boolean;
  costOfWaiting: number;
  recurring: boolean;
  efficiency: number;
}

/** Price every payable and resolve its tier (honouring overrides). Order is preserved. */
function price(payables: Payable[], overrides: Record<string, PayableTier>): Priced[] {
  return payables.map((p) => {
    const { cost, recurring } = costOf(p);
    const ov = overrides[p.id];
    const tier: PayableTier = ov ?? (p.mandatoryDefault ? "mandatory" : "deferrable");
    return {
      ...p,
      tier,
      overridden: ov != null && (ov === "mandatory") !== p.mandatoryDefault,
      costOfWaiting: cost,
      recurring,
      efficiency: p.amount > 0 ? round2((cost / p.amount) * 100) : 0,
    };
  });
}

/** Allocate `remaining` to one priced item; return what it took and the verdict + deferred cost. */
function allocate(p: Priced, remaining: number): { allocated: number; verdict: RankedPayable["verdict"]; deferredCost: number } {
  const want = Math.max(0, p.amount);
  if (want <= 0) return { allocated: 0, verdict: "pay", deferredCost: 0 };

  let allocated: number;
  if (p.divisible) {
    allocated = round2(Math.min(want, Math.max(0, remaining)));
  } else {
    // All-or-nothing: take it only if the whole thing fits (greedy — a smaller later item may still fit).
    allocated = remaining + 1e-6 >= want ? want : 0;
  }
  const unpaid = Math.max(0, round2(want - allocated));
  // deferredCost is the share of cost-of-waiting on the unpaid portion (linear for rate-based items).
  const deferredCost = round2(p.costOfWaiting * (unpaid / want));
  const verdict: RankedPayable["verdict"] = allocated <= 0 ? "defer" : unpaid > 0.005 ? "partial" : "pay";
  return { allocated, verdict, deferredCost };
}

function toRanked(p: Priced, a: { allocated: number; verdict: RankedPayable["verdict"]; deferredCost: number }): RankedPayable {
  return {
    id: p.id,
    label: p.label,
    kind: p.kind,
    sub: p.sub ?? null,
    amount: p.amount,
    divisible: p.divisible,
    tier: p.tier,
    overridden: p.overridden,
    annualRatePct: p.annualRatePct ?? null,
    costOfWaiting: p.costOfWaiting,
    recurring: p.recurring,
    efficiency: p.efficiency,
    allocated: a.allocated,
    verdict: a.verdict,
    deferredCost: a.deferredCost,
  };
}

/**
 * Rank this month's payables and allocate the typed balance.
 *
 * Mandatory first (listed order, never re-sorted — rent must out-rank a loan's interest),
 * then the deferrable items by the chosen column. Partial payments allowed on divisible
 * (loan) items; whole bills/taxes are all-or-nothing (a skipped big item lets a smaller
 * later one still fit). `shortfall` > 0 means the balance couldn't even cover the mandatory tier.
 */
export function rankPayables(input: RankInput): RankResult {
  const overrides = input.overrides ?? {};
  const priced = price(input.payables, overrides);

  const mandatorySrc = priced.filter((p) => p.tier === "mandatory"); // listed order preserved
  const deferrableSrc = priced
    .filter((p) => p.tier === "deferrable")
    .sort((a, b) => (input.sortBy === "efficiency" ? b.efficiency - a.efficiency : b.costOfWaiting - a.costOfWaiting));

  let remaining = Math.max(0, input.balance);
  const mandatory: RankedPayable[] = [];
  let shortfall = 0;
  for (const p of mandatorySrc) {
    const a = allocate(p, remaining);
    remaining = round2(remaining - a.allocated);
    if (a.allocated + 0.005 < p.amount) shortfall = round2(shortfall + (p.amount - a.allocated));
    mandatory.push(toRanked(p, a));
  }

  const deferrable: RankedPayable[] = [];
  for (const p of deferrableSrc) {
    const a = allocate(p, remaining);
    remaining = round2(remaining - a.allocated);
    deferrable.push(toRanked(p, a));
  }

  const all = [...mandatory, ...deferrable];
  const spent = round2(all.reduce((s, r) => s + r.allocated, 0));
  const penaltyIncurred = round2(all.reduce((s, r) => s + r.deferredCost, 0));
  const penaltyAvoided = round2(all.reduce((s, r) => s + (r.costOfWaiting - r.deferredCost), 0));

  return {
    balance: round2(input.balance),
    mandatory,
    deferrable,
    mandatoryTotal: round2(mandatorySrc.reduce((s, p) => s + p.amount, 0)),
    spent,
    leftover: round2(Math.max(0, input.balance - spent)),
    shortfall,
    penaltyAvoided,
    penaltyIncurred,
  };
}
