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
  fundsMember?: boolean; // a disbursement piece timed to fund the recipient's own bills below
  reroute?: boolean; // a disbursement paid DIRECT by a debtor (not via the hub) because the hub couldn't fund it in time
  infeasibleFrom?: number | null; // this piece can't be funded by its due day; earliest day it becomes fundable (null = never this month)
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
  const outbound = transfers.filter((t) => t.toId !== treasurerId && t.fromId === treasurerId); // hub → creditor
  // Disbursements happen only after everything has been collected AND the bills paid, so anchor
  // undated/residual outbound transfers to the latest inbound-income day OR bill due-day, whichever
  // is later. Undated bills contribute 0 here — a bill with no due date shouldn't push the payout later.
  const lastDay = Math.max(1, ...inbound.map((t) => incomeDayByMember[t.fromId] ?? 1), ...bills.map((b) => b.day ?? 0));
  const hasHubBills = bills.some((b) => b.payerId === treasurerId && !b.done);
  // Each income event with the day it lands (undated → up front). Shared by the scheduler AND the walk.
  const arrivalList = incomeArrivals ?? Object.entries(incomeByMember).map(([k, v]) => ({ memberId: Number(k), day: null as number | null, amount: v }));
  // A tiny chronological accumulator: cashBy(day) = Σ of events landing on/before `day` (undated = day 0).
  const cashBy = (events: { day: number | null; amount: number }[]) => {
    const ev = events.map((e) => ({ day: e.day ?? 0, amount: e.amount }));
    return (upto: number) => ev.reduce((s, e) => (e.day <= upto ? s + e.amount : s), 0);
  };

  const steps: PlanStep[] = [];
  // Inbound collections: a debtor pays their net to the hub when THEIR income lands.
  for (const t of inbound) {
    steps.push({
      id: `xfer-${t.fromId}-${t.toId}`, kind: "transfer-in", day: incomeDayByMember[t.fromId] ?? null,
      amount: t.amount, done: t.settled, fromId: t.fromId, toId: t.toId, fromName: t.from, toName: t.to,
      recordId: t.recordId, status: t.status ?? null, days: t.days ?? null, feedsBills: hasHubBills,
    });
  }
  // Already-settled disbursements happened — show them as a single done step, don't re-schedule them.
  for (const t of outbound.filter((o) => o.settled)) {
    steps.push({ id: `xfer-${t.fromId}-${t.toId}`, kind: "transfer-out", day: lastDay, amount: t.amount, done: true, fromId: t.fromId, toId: t.toId, fromName: t.from, toName: t.to, recordId: t.recordId });
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

  // ── Disbursement scheduler ────────────────────────────────────────────────────────────────────
  // A creditor's net (hub → them) can't be handed over as one lump on day 1 — they need it as their
  // OWN bills fall due, and the hub can only pay from cash it has actually collected by then. So we
  // SPLIT each unsettled disbursement into timed pieces matched to (a) when the creditor needs it and
  // (b) when the hub can fund it. If the hub can't cover a piece by its due day, we REROUTE it —
  // paid directly by a debtor who's holding spare cash (that debtor then owes the hub that much less).
  // If even that can't cover it in time, the piece is flagged infeasible with the earliest day it can.
  const unsettledOut = outbound.filter((o) => !o.settled);
  // ALL of a member's cash bills, with their paid flag — a DONE bill already consumed their cash (so it
  // still counts against their liquidity), but only an UNPAID one can generate a funding need.
  const cashBillsOf = (memberId: number) => bills.filter((b) => !b.fund && b.payerId === memberId).map((b) => ({ day: b.day ?? lastDay, amount: -b.amount, done: b.done }));
  const incomeOf = (memberId: number) => arrivalList.filter((a) => a.memberId === memberId).map((a) => ({ day: a.day ?? 0, amount: a.amount }));

  // The creditor's need schedule: walk their own income (in) and cash bills (out) chronologically; each
  // time an UNPAID bill would push them below zero, that shortfall is a "need" the pool must cover by
  // that day. A done bill that dips them negative was already covered (it's paid), so it resets to 0
  // without generating a need — otherwise its cost would leak into the next bill and over-fund.
  const needsOf = (creditorId: number): { day: number; amount: number }[] => {
    const evs = [
      ...incomeOf(creditorId).map((e) => ({ ...e, in: true, done: false })),
      ...cashBillsOf(creditorId).map((e) => ({ ...e, in: false })),
    ].sort((a, b) => a.day - b.day || (a.in === b.in ? 0 : a.in ? -1 : 1)); // income lands before you pay, same day
    let self = 0;
    const needs: { day: number; amount: number }[] = [];
    for (const e of evs) {
      self = Math.round((self + e.amount) * 100) / 100;
      if (!e.in && self < -0.005) { if (!e.done) needs.push({ day: e.day, amount: Math.round(-self * 100) / 100 }); self = 0; }
    }
    return needs;
  };

  // Hub cash timeline (before any NEW disbursement): treasurer's own income + every collection in,
  // minus the treasurer's own cash bills and any already-settled disbursements.
  const hubCashBy = cashBy([
    ...incomeOf(treasurerId ?? -1),
    ...inbound.map((t) => ({ day: incomeDayByMember[t.fromId] ?? null, amount: t.amount })),
    ...bills.filter((b) => !b.fund && b.payerId === treasurerId).map((b) => ({ day: b.day, amount: -b.amount })),
    ...outbound.filter((o) => o.settled).map((o) => ({ day: 0 as number | null, amount: -o.amount })),
  ]);
  const hubCanCoverBy = (need: number, from: number, used: number): number | null => {
    for (let d = from; d <= 31; d++) if (hubCashBy(d) - used >= need - 0.005) return d;
    return null;
  };

  // Debtors who could front cash for a reroute: how much each can safely lend by a given day =
  // cash in hand then − ALL their own cash bills (never leave them short) − what they've already lent,
  // capped by the net they owe the hub anyway (lending replaces that payment).
  const debtorState = inbound.map((t) => ({
    id: t.fromId, name: t.from, netRemaining: t.amount,
    cashBy: cashBy(incomeOf(t.fromId)), ownBills: cashBillsOf(t.fromId).filter((b) => !b.done).reduce((s, b) => s + b.amount, 0), // negative sum, unpaid only
    lent: 0,
  }));

  const owed = new Map<number, number>(unsettledOut.map((o) => [o.toId!, o.amount]));
  const recOf = new Map<number, { name: string; recordId: number | null }>(unsettledOut.map((o) => [o.toId!, { name: o.to, recordId: o.recordId }]));
  const allNeeds = unsettledOut.flatMap((o) => needsOf(o.toId!).map((n) => ({ ...n, creditorId: o.toId! }))).sort((a, b) => a.day - b.day);
  const pieces: PlanStep[] = [];
  let hubUsed = 0;
  const emit = (creditorId: number, day: number, amount: number, fromId: number, fromName: string, reroute: boolean, fundsMember: boolean, infeasibleFrom?: number | null) => {
    const r = recOf.get(creditorId)!;
    pieces.push({
      id: `disb-${creditorId}-${fromId}-${day}-${Math.round(amount)}`, kind: "transfer-out", day, amount: Math.round(amount * 100) / 100, done: false,
      fromId, toId: creditorId, fromName, toName: r.name, recordId: reroute ? null : r.recordId, fundsMember, reroute,
      ...(infeasibleFrom !== undefined ? { infeasibleFrom } : {}), // only flag pieces that genuinely can't be funded by their day
    });
  };
  for (const need of allNeeds) {
    let amt = Math.min(need.amount, owed.get(need.creditorId) ?? 0);
    if (amt <= 0.005) continue;
    const treasurerName2 = treasurerName ?? "Treasurer";
    // 1. fund from the hub's collected cash by this day
    const avail = hubCashBy(need.day) - hubUsed;
    const fromHub = Math.min(amt, Math.max(0, avail));
    if (fromHub > 0.005) { emit(need.creditorId, need.day, fromHub, treasurerId!, treasurerName2, false, true); hubUsed += fromHub; owed.set(need.creditorId, (owed.get(need.creditorId) ?? 0) - fromHub); amt -= fromHub; }
    // 2. reroute the rest from any debtor holding spare cash by this day
    if (amt > 0.005) {
      for (const d of debtorState) {
        if (d.id === need.creditorId) continue;
        const spare = Math.min(d.netRemaining, d.cashBy(need.day) + d.ownBills - d.lent); // ownBills is negative
        const lend = Math.min(amt, Math.max(0, spare), owed.get(need.creditorId) ?? 0);
        if (lend > 0.005) { emit(need.creditorId, need.day, lend, d.id, d.name, true, true); d.lent += lend; d.netRemaining -= lend; owed.set(need.creditorId, (owed.get(need.creditorId) ?? 0) - lend); amt -= lend; }
        if (amt <= 0.005) break;
      }
    }
    // 3. genuinely unfundable by this day — still show it (from the hub) but flag the earliest feasible day
    if (amt > 0.005) {
      const feasible = hubCanCoverBy(amt, need.day, hubUsed);
      emit(need.creditorId, need.day, amt, treasurerId!, treasurerName2, false, true, feasible);
      hubUsed += amt; owed.set(need.creditorId, (owed.get(need.creditorId) ?? 0) - amt);
    }
  }
  // Whatever a creditor is still owed beyond their dated needs → one final payout at month-end (this
  // isn't funding a specific bill, so it's NOT a fundsMember piece — it sorts after bills, like a payout).
  for (const [creditorId, left] of owed) {
    if (left <= 0.005) continue;
    emit(creditorId, lastDay, left, treasurerId!, treasurerName ?? "Treasurer", false, false);
  }
  steps.push(...pieces);

  // A reroute means a debtor paid a creditor directly, so that debtor owes the hub that much LESS —
  // shrink their inbound collection to match (drop it entirely if fully redirected). Keeps the books
  // balanced: debtor→hub + hub→creditor collapses into the single debtor→creditor we just emitted.
  for (const d of debtorState) {
    if (d.lent <= 0.005) continue;
    const inStep = steps.find((s) => s.kind === "transfer-in" && s.fromId === d.id && !s.done);
    if (!inStep) continue;
    inStep.amount = Math.round((inStep.amount - d.lent) * 100) / 100;
    if (inStep.amount <= 0.005) steps.splice(steps.indexOf(inStep), 1);
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
  const arrivals = arrivalList.slice().sort((a, b) => (a.day == null ? -1 : b.day == null ? 1 : a.day - b.day)); // undated first (available up front)
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
