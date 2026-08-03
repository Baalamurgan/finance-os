// The Money Plan (Phase B): a single ORDERED, DATED choreography of the month's money movements,
// derived purely from records that already exist — settlement transfers (who → the treasurer hub)
// and dated bill payments. It invents no new money: the "remainder back to a member" transfers
// already fall out of the settlement net math; the plan just places everything in time so the
// family can execute it step by step. Completion is written through to the underlying records
// (SettlementRecord / bill paid) elsewhere, so this stays a projection, never a second ledger.

export type PlanTransfer = { fromId: number; from: string; toId: number; to: string; amount: number; settled: boolean; recordId: number | null; status?: "overdue" | "soon" | "normal" | null; days?: number | null };
export type PlanBill = {
  key: string; payerId: number | null; payerName: string; vendor: string; amount: number; done: boolean;
  day: number | null; status: "overdue" | "soon" | "normal" | null; days?: number | null; billId?: number; categoryId?: number; fund?: boolean; fundAvail?: number;
};
// An allowance = personal money the treasurer SENDS a member (not a bill they owe). Disbursed after
// collection, never dated/overdue; completion writes through to the Sheet line's paid flag (billId).
export type PlanAllowance = { key: string; recipientId: number; recipientName: string; amount: number; done: boolean; billId: number };
// A piggy return = a budget holder handing their unspent budget (gross positive leftovers) to the
// Piggy holder at wind-down, so the general Piggy ends up under one person. A live projection (not
// final until wind-down), always LOWEST priority — the sender only pays it once they're flush.
export type PlanPiggyReturn = { key: string; fromId: number; fromName: string; toId: number; toName: string; amount: number };

export type PlanStep = {
  id: string;
  kind: "transfer-in" | "transfer-out" | "bill" | "allowance" | "piggy";
  day: number | null; // effective day-of-month for ordering/display (null = undated)
  amount: number;
  done: boolean;
  // transfer
  fromId?: number; toId?: number; fromName?: string; toName?: string; recordId?: number | null; feedsBills?: boolean;
  fundsMember?: boolean; // a disbursement pulled early to fund the recipient's own bills below
  // bill
  payerId?: number | null; payerName?: string; vendor?: string; billId?: number; categoryId?: number; fund?: boolean; fundAvail?: number;
  status?: "overdue" | "soon" | "normal" | null;
  days?: number | null; // days until due (negative = overdue), for the urgency tag
  short?: number; // hub is short this much when this step runs (funds not in yet)
  hubAfter?: number; // treasurer's running settlement balance right after this step (hub steps only)
  actorLeft?: number; // for a member's own step: how much they still have to pay out after this
  balancesAfter?: Record<number, number>; // every member's running cash position right after this step
  senderShort?: number; // the step's sender can't cover it from cash-in-hand yet — short by this much
};

export type MoneyPlan = { steps: PlanStep[]; done: number; total: number; hubShortfall: number };

export function buildMoneyPlan(input: {
  treasurerId: number | null;
  treasurerName?: string;
  transfers: PlanTransfer[];
  bills: PlanBill[];
  allowances?: PlanAllowance[];
  piggyReturns?: PlanPiggyReturn[];
  incomeDayByMember: Record<number, number>; // earliest arrival day per member
  incomeByMember?: Record<number, number>; // total income each member owns this month (their own cash)
  incomeArrivals?: { memberId: number; day: number | null; amount: number }[]; // each income event + the day it lands
}): MoneyPlan {
  const { treasurerId, treasurerName, transfers, bills, allowances = [], piggyReturns = [], incomeDayByMember, incomeByMember = {}, incomeArrivals } = input;

  const inbound = transfers.filter((t) => t.toId === treasurerId);
  // Disbursements happen only after everything has been collected AND the bills paid, so anchor
  // outbound transfers to the latest inbound-income day OR bill due-day, whichever is later.
  // Undated bills contribute 0 here — a bill with no due date shouldn't push the payout later.
  const lastDay = Math.max(1, ...inbound.map((t) => incomeDayByMember[t.fromId] ?? 1), ...bills.map((b) => b.day ?? 0));
  const hasHubBills = bills.some((b) => b.payerId === treasurerId && !b.done);

  const steps: PlanStep[] = [];
  for (const t of transfers) {
    const isIn = t.toId === treasurerId;
    steps.push({
      id: `xfer-${t.fromId}-${t.toId}`,
      kind: isIn ? "transfer-in" : "transfer-out",
      // inbound arrives when the payer's income lands; outbound (disbursement) after collection
      day: isIn ? incomeDayByMember[t.fromId] ?? null : lastDay,
      amount: t.amount, done: t.settled,
      fromId: t.fromId, toId: t.toId, fromName: t.from, toName: t.to, recordId: t.recordId,
      status: isIn ? t.status ?? null : null,
      days: isIn ? t.days ?? null : null,
      feedsBills: isIn && hasHubBills, // collected first → funds the treasurer's bills below
    });
  }
  for (const b of bills) {
    steps.push({
      id: b.key, kind: "bill", day: b.day, amount: b.amount, done: b.done,
      payerId: b.payerId, payerName: b.payerName, vendor: b.vendor, billId: b.billId, categoryId: b.categoryId, fund: b.fund, fundAvail: b.fundAvail, status: b.status, days: b.days ?? null,
    });
  }
  // Allowances: the treasurer disburses these AFTER collection (like a payout), never dated/overdue.
  // Rendered as "Send → <member>"; ticking one writes through to the Sheet line's paid flag (billId).
  for (const a of allowances) {
    steps.push({
      id: a.key, kind: "allowance", day: lastDay, amount: a.amount, done: a.done,
      fromId: treasurerId ?? undefined, toId: a.recipientId, fromName: treasurerName, toName: a.recipientName,
      billId: a.billId, status: null, days: null,
    });
  }
  // Piggy returns: the very last thing each month — a holder hands their unspent budget to the Piggy
  // holder. Undated + lowest priority (below even other undated steps), a projection until wind-down.
  for (const p of piggyReturns) {
    steps.push({
      id: p.key, kind: "piggy", day: null, amount: p.amount, done: false,
      fromId: p.fromId, toId: p.toId, fromName: p.fromName, toName: p.toName, status: null, days: null,
    });
  }

  // Fund members before they pay: a disbursement (hub → member) that has bills/outflows below it is
  // pulled up to land right before that member's EARLIEST outflow, so they have the cash in hand to
  // do it — instead of sitting at the end with all the disbursements. (If the hub hasn't collected
  // enough by then, the hub-short flag below still catches it.) Only a DATED CASH bill counts as an
  // outflow that needs funding: a fund bill is paid from its sinking fund (no cash), and an undated
  // bill has no deadline to beat — neither should drag a disbursement early.
  const outflowDay = new Map<number, number>();
  for (const s of steps) {
    if (!(s.kind === "bill" && !s.fund) || s.payerId == null || s.payerId === treasurerId || s.day == null) continue;
    outflowDay.set(s.payerId, Math.min(outflowDay.get(s.payerId) ?? Infinity, s.day));
  }
  for (const s of steps) {
    if (s.kind !== "transfer-out" || s.toId == null) continue;
    const need = outflowDay.get(s.toId);
    if (need != null && need !== Infinity) { s.day = need; s.fundsMember = true; }
  }

  // Display order: by due date (soonest first). Within a day: income in → funding disbursements →
  // bills → other disbursements/allowances out → piggy returns (money comes in, members get funded,
  // bills get paid, the remainder flows back). Anything with NO due date sinks to the very bottom.
  const rank = (s: PlanStep) =>
    s.kind === "transfer-in" ? 0 : s.kind === "transfer-out" && s.fundsMember ? 1 : s.kind === "bill" ? 2 : s.kind === "piggy" ? 4 : 3;
  // Undated INBOUND collections are gathered UP FRONT (money in before money out) — an unknown income
  // day must never sort a collection AFTER the disbursements/bills it funds, which would make the hub
  // look deeply negative when in truth the cash is simply collected first. Undated bills, disbursements
  // and piggy returns still sink to the very bottom (no deadline = lowest priority).
  const eff = (s: PlanStep) => (s.day == null ? (s.kind === "transfer-in" ? 0 : Infinity) : s.day);
  steps.sort((a, b) => eff(a) - eff(b) || rank(a) - rank(b) || b.amount - a.amount);

  // Per-actor "still to pay" for the member chip: a pure running sum of that person's own outgoing
  // steps (their transfer to the hub + the bills they pay), decremented as the plan proceeds. Since
  // it's derived only from the plan's own steps it can't drift from anything. The treasurer is shown
  // via the hub balance above, so they're excluded here.
  const actorOf = (s: PlanStep): number | null => (s.kind === "bill" ? s.payerId ?? null : s.fromId ?? null);
  const remaining = new Map<number, number>();
  for (const s of steps) { const a = actorOf(s); if (a != null && a !== treasurerId && !s.done) remaining.set(a, (remaining.get(a) ?? 0) + s.amount); }
  for (const s of steps) {
    const a = actorOf(s);
    if (a == null || a === treasurerId || s.done) continue;
    const after = Math.round(((remaining.get(a) ?? 0) - s.amount) * 100) / 100;
    remaining.set(a, after);
    s.actorLeft = after;
  }

  // Running cash position for EVERY member (treasurer included), walked in display order and made
  // ARRIVAL-AWARE: each member's own income is credited to their cash ON the day it actually lands
  // (undated income is treated as available up front, consistent with collecting before paying). We
  // don't model prior savings, so a member's liquidity IS this month's income — which is exactly what
  // lets the plan catch the real trap: someone asked to pay (or disburse) BEFORE their money arrives.
  // For each UNPAID step the SENDER must have the cash in hand; if not, it's flagged — senderShort for
  // a member, and s.short + hubShortfall when the sender is the treasurer. Fund bills draw the sinking
  // fund, not cash, so they neither need cash nor move any. The treasurer's cash IS balancesAfter[his
  // id], so hubAfter is just his running balance — one source of truth, no separate hub accumulator.
  const arrivals = (incomeArrivals ?? Object.entries(incomeByMember).map(([k, v]) => ({ memberId: Number(k), day: null as number | null, amount: v })))
    .slice()
    .sort((a, b) => (a.day == null ? -1 : b.day == null ? 1 : a.day - b.day)); // undated first (available up front)
  const bal = new Map<number, number>();
  let ai = 0;
  const creditUpTo = (upto: number) => {
    while (ai < arrivals.length && (arrivals[ai].day == null || arrivals[ai].day! <= upto)) {
      const a = arrivals[ai++];
      bal.set(a.memberId, Math.round(((bal.get(a.memberId) ?? 0) + a.amount) * 100) / 100);
    }
  };
  const shift = (id: number | null | undefined, delta: number) => {
    if (id == null) return;
    bal.set(id, Math.round(((bal.get(id) ?? 0) + delta) * 100) / 100);
  };
  const senderOf = (s: PlanStep): number | null => (s.kind === "bill" ? s.payerId ?? null : s.fromId ?? null);
  const touchesHub = (s: PlanStep): boolean =>
    treasurerId != null &&
    ((s.kind === "bill" && !s.fund && s.payerId === treasurerId) ||
      ((s.kind === "transfer-in" || s.kind === "transfer-out" || s.kind === "allowance") && (s.fromId === treasurerId || s.toId === treasurerId)));
  let hubShortfall = 0;
  for (const s of steps) {
    creditUpTo(eff(s)); // credit every income that has landed by the time this step runs
    const usesCash = !(s.kind === "bill" && s.fund);
    const senderId = senderOf(s);
    if (!s.done && usesCash && senderId != null) {
      const before = bal.get(senderId) ?? 0;
      if (before < s.amount - 0.005) {
        const short = Math.round((s.amount - before) * 100) / 100;
        if (senderId === treasurerId) { s.short = short; hubShortfall = Math.max(hubShortfall, short); }
        else s.senderShort = short;
      }
    }
    if (s.kind === "transfer-in" || s.kind === "transfer-out" || s.kind === "allowance" || s.kind === "piggy") {
      shift(s.fromId, -s.amount);
      shift(s.toId, s.amount);
    } else if (s.kind === "bill" && !s.fund) {
      shift(s.payerId, -s.amount); // paid to an external vendor — leaves the family
    }
    s.balancesAfter = Object.fromEntries(bal);
    if (touchesHub(s)) s.hubAfter = bal.get(treasurerId!) ?? 0;
  }

  // Piggy returns are live projections (finalised at wind-down), so they don't count toward the
  // "N/total done" progress — they're a heads-up of the last move, not a tickable settlement step.
  const counted = steps.filter((s) => s.kind !== "piggy");
  const done = counted.filter((s) => s.done).length;
  return { steps, done, total: counted.length, hubShortfall: Math.round(hubShortfall) };
}
