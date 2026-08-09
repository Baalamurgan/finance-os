// The Money Plan (Phase B): a single ORDERED, DATED choreography of the month's money movements,
// derived purely from records that already exist — settlement transfers (who → the treasurer hub)
// and dated bill payments. It invents no new money: the "remainder back to a member" transfers
// already fall out of the settlement net math; the plan just places everything in time so the
// family can execute it step by step. Completion is written through to the underlying records
// (SettlementRecord / bill paid) elsewhere, so this stays a projection, never a second ledger.

export type PlanTransfer = { fromId: number; from: string; toId: number; to: string; amount: number; paidAmount?: number | null; settled: boolean; recordId: number | null; status?: "overdue" | "soon" | "normal" | null; days?: number | null };
export type PlanBill = {
  key: string; payerId: number | null; payerName: string; vendor: string; amount: number; done: boolean;
  day: number | null; status: "overdue" | "soon" | "normal" | null; days?: number | null; billId?: number; categoryId?: number; fund?: boolean; fundAvail?: number;
  deferred?: boolean; // a wind-down-overhang expense: paid by its assignee at wind-down, out of the settlement
};
// An allowance = personal money the treasurer SENDS a member (not a bill they owe). Disbursed after
// collection, never dated/overdue; completion writes through to the Sheet line's paid flag (billId).
export type PlanAllowance = { key: string; recipientId: number; recipientName: string; amount: number; done: boolean; billId: number; day?: number | null; status?: "overdue" | "soon" | "normal" | null; days?: number | null };
// A piggy return = a budget holder handing their unspent budget (gross positive leftovers) to the
// Piggy holder at wind-down, so the general Piggy ends up under one person. A live projection (not
// final until wind-down), always LOWEST priority — the sender only pays it once they're flush.
export type PlanPiggyReturn = { key: string; fromId: number; fromName: string; toId: number; toName: string; amount: number };
// A funding advance: a member fronts cash to a short member, scheduled just before the step it funds.
// It's a round-trip LOAN — the FRONT (funder → borrower, day/done) plus a PAYBACK leg (borrower →
// funder) that returns the same amount once the borrower's income has landed (paybackDay/paybackDone).
export type PlanAdvance = { id: number; fromId: number; fromName: string; toId: number; toName: string; amount: number; day: number | null; done: boolean; paybackDay: number | null; paybackDone: boolean };

export type PlanStep = {
  id: string;
  kind: "transfer-in" | "transfer-out" | "bill" | "allowance" | "piggy" | "advance" | "income";
  day: number | null; // effective day-of-month for ordering/display (null = undated)
  amount: number;
  done: boolean;
  // income (informational: a member's own income landing — credits their cash in the walk, not tickable)
  source?: string; // the income line's label (e.g. "Salary", "Rent")
  incomeId?: number; // the IncomeEntry id — lets the head edit the arrival day from the plan
  handoverPeriodId?: number; // piggy hand-over step: the wound-down period whose leftover is being handed over (ticking marks it handed over)
  settleAmount?: number; // amount to record when THIS step is ticked (a funding remainder settles the creditor's FULL net, not just this slice)
  // transfer
  fromId?: number; toId?: number; fromName?: string; toName?: string; recordId?: number | null; feedsBills?: boolean;
  fundsMember?: boolean; // a disbursement piece timed to fund the recipient's own bills below
  advanceId?: number; // this step is a funding advance (write-through to the Advance record)
  payback?: boolean; // this advance step is the PAYBACK leg (borrower → funder), not the front
  reimbursement?: boolean; // a disbursement that pays a member back for prior-month out-of-pocket spends (scheduled early)
  reroute?: boolean; // a disbursement paid DIRECT by a debtor (not via the hub) because the hub couldn't fund it in time
  infeasibleFrom?: number | null; // this piece can't be funded by its due day; earliest day it becomes fundable (null = never this month)
  // bill
  payerId?: number | null; payerName?: string; vendor?: string; billId?: number; categoryId?: number; fund?: boolean; fundAvail?: number; deferred?: boolean;
  status?: "overdue" | "soon" | "normal" | null;
  days?: number | null; // days until due (negative = overdue), for the urgency tag
  short?: number; // hub is short this much when this step runs (funds not in yet)
  hubAfter?: number; // treasurer's running settlement balance right after this step (hub steps only)
  actorLeft?: number; // for a member's own step: how much they still have to pay out after this
  balancesBefore?: Record<number, number>; // every member's cash right BEFORE this step runs
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
  advances?: PlanAdvance[];
  incomeDayByMember: Record<number, number>; // earliest arrival day per member
  incomeByMember?: Record<number, number>; // total income each member owns this month (their own cash)
  incomeArrivals?: { memberId: number; day: number | null; amount: number; source?: string; name?: string; id?: number }[]; // each income event + the day it lands
  reimburseByMember?: Record<number, number>; // prior-month out-of-pocket spend each member is owed back
  reimburseDay?: number; // target day to hand back those reimbursements (e.g. the day after wind-down)
  piggyHandover?: { toId: number; toName: string; handoverPeriodId: number; owners: { fromId: number; fromName: string; amount: number; day: number }[] }; // prior wound-down month's leftover — one tickable step per owner who hands their slice to the Piggy holder
}): MoneyPlan {
  const { treasurerId, treasurerName, transfers, bills, allowances = [], piggyReturns = [], advances = [], incomeDayByMember, incomeByMember = {}, incomeArrivals, reimburseByMember = {}, reimburseDay, piggyHandover } = input;

  const inbound = transfers.filter((t) => t.toId === treasurerId);
  const outbound = transfers.filter((t) => t.toId !== treasurerId && t.fromId === treasurerId); // hub → creditor
  // Paid-so-far on a (possibly PARTIALLY) settled disbursement. An early reimbursement can settle just
  // a SLICE of what the hub owes a creditor (the settlement record holds one amount); the unpaid rest
  // must still be scheduled below, or the creditor's later bills would show unfunded. paidOf clamps to net.
  const paidOf = (o: PlanTransfer) => Math.min(o.paidAmount ?? o.amount, o.amount);
  // Full net owed to each creditor, so ticking a remainder funding piece settles them FULLY (records the
  // whole net), rather than overwriting the record with just that slice.
  const netOwedByCreditor = new Map<number, number>(outbound.map((o) => [o.toId, o.amount]));
  // What's already been paid to each creditor (a partial early settlement). The early REIMBURSEMENT is
  // normally the first thing paid, so this reduces the reimbursement need below — otherwise it would be
  // scheduled again on top of the already-paid slice (double-counting it).
  const paidByCreditor = new Map<number, number>(outbound.filter((o) => o.settled).map((o) => [o.toId, paidOf(o)]));
  // Disbursements happen only after everything has been collected AND the bills paid, so anchor
  // undated/residual outbound transfers to the latest inbound-income day OR bill due-day, whichever
  // is later. Undated bills contribute 0 here — a bill with no due date shouldn't push the payout later.
  const lastDay = Math.max(1, ...inbound.map((t) => incomeDayByMember[t.fromId] ?? 1), ...bills.map((b) => b.day ?? 0));
  const hasHubBills = bills.some((b) => b.payerId === treasurerId && !b.done);
  // Each income event with the day it lands (undated → up front). Shared by the scheduler AND the walk.
  const arrivalList: { memberId: number; day: number | null; amount: number; source?: string; name?: string; id?: number }[] =
    incomeArrivals ?? Object.entries(incomeByMember).map(([k, v]) => ({ memberId: Number(k), day: null, amount: v }));
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
  // Already-PAID disbursement portion → one done step for the amount actually handed over (paidOf).
  // A partial payment (paid < net) leaves a remainder that's re-scheduled via unsettledOut below.
  for (const t of outbound.filter((o) => o.settled)) {
    const paid = Math.round(paidOf(t) * 100) / 100;
    if (paid > 0.005) steps.push({ id: `xfer-${t.fromId}-${t.toId}`, kind: "transfer-out", day: lastDay, amount: paid, done: true, fromId: t.fromId, toId: t.toId, fromName: t.from, toName: t.to, recordId: t.recordId });
  }
  for (const b of bills) {
    steps.push({
      id: b.key, kind: "bill", day: b.day, amount: b.amount, done: b.done,
      payerId: b.payerId, payerName: b.payerName, vendor: b.vendor, billId: b.billId, categoryId: b.categoryId, fund: b.fund, fundAvail: b.fundAvail, status: b.status, days: b.days ?? null, deferred: b.deferred,
    });
  }
  // Allowances: the treasurer disburses these AFTER collection (like a payout), never dated/overdue.
  // Rendered as "Send → <member>"; ticking one writes through to the Sheet line's paid flag (billId).
  for (const a of allowances) {
    steps.push({
      // dated → sent on that day (in order, liquidity-checked); undated → after collection (last day)
      id: a.key, kind: "allowance", day: a.day ?? lastDay, amount: a.amount, done: a.done,
      fromId: treasurerId ?? undefined, toId: a.recipientId, fromName: treasurerName, toName: a.recipientName,
      billId: a.billId, status: a.status ?? null, days: a.days ?? null,
    });
  }
  // Funding advances: a round-trip loan. The FRONT (funder → borrower) is scheduled just before the
  // step it funds (same day, ranked ahead of bills). The PAYBACK (borrower → funder) returns the same
  // amount once the borrower's income has landed — it funds nothing, so it sorts like a normal payout.
  // Both legs are real cash moves, each tickable via the Advance record (front = settled, payback =
  // paybackSettled). The payback closes the loop so end-of-month cash matches the settlement books.
  for (const a of advances) {
    steps.push({
      id: `adv-${a.id}`, kind: "advance", day: a.day, amount: a.amount, done: a.done,
      fromId: a.fromId, toId: a.toId, fromName: a.fromName, toName: a.toName, advanceId: a.id, fundsMember: true, status: null, days: null,
    });
    steps.push({
      id: `advpay-${a.id}`, kind: "advance", day: a.paybackDay, amount: a.amount, done: a.paybackDone,
      fromId: a.toId, toId: a.fromId, fromName: a.toName, toName: a.fromName, advanceId: a.id, payback: true, fundsMember: false, status: null, days: null,
    });
  }
  // Income arrivals: each income event shown as its own informational row on the day it lands, so the
  // plan reads "money in → money out" (income first, expense next). NOT tickable and NOT counted in
  // progress — it exists to explain the balance walk (the recipient's cash visibly jumps at this row).
  arrivalList.forEach((a, i) => {
    if (a.amount <= 0.005) return;
    steps.push({
      id: `income-${a.memberId}-${i}`, kind: "income", day: a.day, amount: Math.round(a.amount * 100) / 100, done: false,
      toId: a.memberId, toName: a.name, source: a.source, incomeId: a.id, status: null, days: null,
    });
  });
  // Piggy returns: the very last thing each month — a holder hands their unspent budget to the Piggy
  // holder. Undated + lowest priority (below even other undated steps), a projection until wind-down.
  for (const p of piggyReturns) {
    steps.push({
      id: p.key, kind: "piggy", day: null, amount: p.amount, done: false,
      fromId: p.fromId, toId: p.toId, fromName: p.fromName, toName: p.toName, status: null, days: null,
    });
  }
  // Prior wound-down month's Piggy hand-over: one tickable combined lump (owners → Piggy holder),
  // dated to the given day (day 1 by default). It's PRIOR-month cash tracked in In-Hand, so it does
  // NOT move this month's cash walk — it's a to-do that, when ticked, marks the month handed over.
  if (piggyHandover) {
    for (const o of piggyHandover.owners) {
      if (o.amount <= 0.005) continue;
      steps.push({
        id: `piggyho-${piggyHandover.handoverPeriodId}-${o.fromId}`, kind: "piggy", day: o.day, amount: Math.round(o.amount * 100) / 100, done: false,
        fromId: o.fromId, fromName: o.fromName, toId: piggyHandover.toId, toName: piggyHandover.toName,
        handoverPeriodId: piggyHandover.handoverPeriodId, status: null, days: null,
      });
    }
  }

  // ── Disbursement scheduler ────────────────────────────────────────────────────────────────────
  // A creditor's net (hub → them) can't be handed over as one lump on day 1 — they need it as their
  // OWN bills fall due, and the hub can only pay from cash it has actually collected by then. So we
  // SPLIT each unsettled disbursement into timed pieces matched to (a) when the creditor needs it and
  // (b) when the hub can fund it. If the hub can't cover a piece by its due day, we REROUTE it —
  // paid directly by a debtor who's holding spare cash (that debtor then owes the hub that much less).
  // If even that can't cover it in time, the piece is flagged infeasible with the earliest day it can.
  // Unsettled = never-settled disbursements PLUS the unpaid REMAINDER of partially-settled ones (net −
  // paid). The remainder keeps the creditor's record id so ticking it settles the same member.
  const unsettledOut = [
    ...outbound.filter((o) => !o.settled),
    ...outbound
      .filter((o) => o.settled)
      .map((o) => ({ ...o, settled: false, amount: Math.round((o.amount - paidOf(o)) * 100) / 100 }))
      .filter((o) => o.amount > 0.005),
  ];
  // ALL of a member's cash bills, with their paid flag — a DONE bill already consumed their cash (so it
  // still counts against their liquidity), but only an UNPAID one can generate a funding need.
  // Deferred (wind-down) bills are the assignee's own responsibility, NOT pool-funded — exclude them
  // from need/spare math so they never pull a disbursement; the balance walk still flags them if short.
  const cashBillsOf = (memberId: number) => bills.filter((b) => !b.fund && !b.deferred && b.payerId === memberId).map((b) => ({ day: b.day ?? lastDay, amount: -b.amount, done: b.done }));
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
    ...outbound.filter((o) => o.settled).map((o) => ({ day: 0 as number | null, amount: -paidOf(o) })), // only what actually left the hub
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
  // Dated needs are bill-driven. Then — for each net-receiver — their prior-month spend reimbursement is
  // injected as a need on `reimburseDay` (e.g. the day after wind-down): pay people back for what they
  // fronted EARLY, so the family plans August around the true remainder. It funds nothing specific, so
  // it yields to real bills (funded from whatever the hub holds by then; any shortfall just slides to the
  // month-end payout — never rerouted onto a debtor or flagged infeasible).
  const billNeeds = unsettledOut.flatMap((o) => needsOf(o.toId!).map((n) => ({ ...n, creditorId: o.toId!, reimbursement: false })));
  const reimburseNeeds =
    reimburseDay == null ? [] :
    Object.entries(reimburseByMember)
      .map(([id, amount]) => ({ creditorId: Number(id), day: reimburseDay, amount: Math.round((amount - (paidByCreditor.get(Number(id)) ?? 0)) * 100) / 100, reimbursement: true }))
      .filter((n) => owed.has(n.creditorId) && n.amount > 0.005); // net-receivers only, less any already-paid slice
  const allNeeds = [...billNeeds, ...reimburseNeeds].sort((a, b) => a.day - b.day);
  const pieces: PlanStep[] = [];
  let hubUsed = 0;
  const emit = (creditorId: number, day: number, amount: number, fromId: number, fromName: string, reroute: boolean, fundsMember: boolean, infeasibleFrom?: number | null, reimbursement?: boolean) => {
    const r = recOf.get(creditorId)!;
    pieces.push({
      id: `${reimbursement ? "reimb" : "disb"}-${creditorId}-${fromId}-${day}-${Math.round(amount)}`, kind: "transfer-out", day, amount: Math.round(amount * 100) / 100, done: false,
      fromId, toId: creditorId, fromName, toName: r.name, recordId: reroute ? null : r.recordId, fundsMember, reroute,
      ...(infeasibleFrom !== undefined ? { infeasibleFrom } : {}), // only flag pieces that genuinely can't be funded by their day
      ...(reimbursement ? { reimbursement: true } : {}),
      // A hub-funded remainder piece settles the creditor's FULL net when ticked (one record per member);
      // the reimbursement slice and rerouted pieces settle their own amount instead.
      ...(!reimbursement && !reroute && netOwedByCreditor.has(creditorId) ? { settleAmount: Math.round((netOwedByCreditor.get(creditorId) ?? 0) * 100) / 100 } : {}),
    });
  };
  for (const need of allNeeds) {
    let amt = Math.min(need.amount, owed.get(need.creditorId) ?? 0);
    if (amt <= 0.005) continue;
    const treasurerName2 = treasurerName ?? "Treasurer";
    // 1. fund from the hub's collected cash by this day
    const avail = hubCashBy(need.day) - hubUsed;
    const fromHub = Math.min(amt, Math.max(0, avail));
    if (fromHub > 0.005) { emit(need.creditorId, need.day, fromHub, treasurerId!, treasurerName2, false, !need.reimbursement, undefined, need.reimbursement); hubUsed += fromHub; owed.set(need.creditorId, (owed.get(need.creditorId) ?? 0) - fromHub); amt -= fromHub; }
    // A reimbursement is soft: whatever the hub can't cover by its day just falls through to the month-end
    // payout below — never rerouted onto a debtor, never flagged infeasible.
    if (need.reimbursement) continue;
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
    s.kind === "income" ? -1 : s.kind === "transfer-in" ? 0 : ((s.kind === "advance" && s.fundsMember) || (s.kind === "transfer-out" && s.fundsMember)) ? 1 : s.kind === "bill" ? (s.deferred ? 3.5 : 2) : s.kind === "piggy" ? 4 : 3;
  // Undated INBOUND collections are gathered UP FRONT (money in before money out) — an unknown income
  // day must never sort a collection AFTER the disbursements/bills it funds, which would make the hub
  // look deeply negative when in truth the cash is simply collected first. Undated bills, disbursements
  // and piggy returns still sink to the very bottom (no deadline = lowest priority).
  const eff = (s: PlanStep) => (s.day == null ? (s.kind === "transfer-in" || s.kind === "income" ? 0 : Infinity) : s.day);
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
  // ARRIVAL-AWARE: each member's own income is credited to their cash BY ITS "income" STEP, which sorts
  // first on the day it lands (undated income up front, rank -1). We don't model prior savings, so a
  // member's liquidity IS this month's income — which is exactly what lets the plan catch the real trap:
  // someone asked to pay (or disburse) BEFORE their money arrives. For each UNPAID step the SENDER must
  // have the cash in hand; if not, it's flagged — senderShort for a member, and s.short + hubShortfall
  // when the sender is the treasurer. Fund bills draw the sinking fund, not cash, so they neither need
  // cash nor move any. The treasurer's cash IS balancesAfter[his id], so hubAfter is just his running
  // balance — one source of truth, no separate hub accumulator.
  const bal = new Map<number, number>();
  const shift = (id: number | null | undefined, delta: number) => {
    if (id == null) return;
    bal.set(id, Math.round(((bal.get(id) ?? 0) + delta) * 100) / 100);
  };
  const senderOf = (s: PlanStep): number | null => (s.kind === "bill" ? s.payerId ?? null : s.fromId ?? null);
  const touchesHub = (s: PlanStep): boolean =>
    treasurerId != null &&
    ((s.kind === "bill" && !s.fund && s.payerId === treasurerId) ||
      (s.kind === "income" && s.toId === treasurerId) ||
      ((s.kind === "transfer-in" || s.kind === "transfer-out" || s.kind === "allowance" || s.kind === "advance") && (s.fromId === treasurerId || s.toId === treasurerId)));
  let hubShortfall = 0;
  for (const s of steps) {
    s.balancesBefore = Object.fromEntries(bal); // snapshot each person's cash BEFORE this step moves any
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
    if (s.kind === "income") {
      shift(s.toId, s.amount); // income lands in the recipient's hand (always — not gated by a done flag)
    } else if (s.kind === "piggy") {
      // Piggy hand-over = PRIOR-month cash (tracked in In-Hand), not this month's income — so it's
      // informational in the cash walk and doesn't move any running balance here.
    } else if (s.kind === "transfer-in" || s.kind === "transfer-out" || s.kind === "allowance" || s.kind === "advance") {
      shift(s.fromId, -s.amount);
      shift(s.toId, s.amount);
    } else if (s.kind === "bill" && !s.fund) {
      shift(s.payerId, -s.amount); // paid to an external vendor — leaves the family
    }
    s.balancesAfter = Object.fromEntries(bal);
    if (touchesHub(s)) s.hubAfter = bal.get(treasurerId!) ?? 0;
  }

  // Income rows are informational and Piggy returns are live projections (finalised at wind-down), so
  // neither counts toward the "N/total done" progress — they're context, not tickable settlement steps.
  const counted = steps.filter((s) => s.kind !== "piggy" && s.kind !== "income");
  const done = counted.filter((s) => s.done).length;
  return { steps, done, total: counted.length, hubShortfall: Math.round(hubShortfall) };
}
