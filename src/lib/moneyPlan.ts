// The Money Plan (Phase B): a single ORDERED, DATED choreography of the month's money movements,
// derived purely from records that already exist — settlement transfers (who → the treasurer hub)
// and dated bill payments. It invents no new money: the "remainder back to a member" transfers
// already fall out of the settlement net math; the plan just places everything in time so the
// family can execute it step by step. Completion is written through to the underlying records
// (SettlementRecord / bill paid) elsewhere, so this stays a projection, never a second ledger.

export type PlanTransfer = { fromId: number; from: string; toId: number; to: string; amount: number; paidAmount?: number | null; settled: boolean; recordId: number | null; payments?: { id: number; amount: number; settledAt?: Date | string | null; key?: string | null }[]; status?: "overdue" | "soon" | "normal" | null; days?: number | null };
export type PlanBill = {
  key: string; payerId: number | null; payerName: string; vendor: string; amount: number; done: boolean;
  day: number | null; status: "overdue" | "soon" | "normal" | null; days?: number | null; billId?: number; categoryId?: number; fund?: boolean; fundAvail?: number;
  misc?: boolean; // a planned misc bill (estimated) → paid via the actual-amount + Piggy-reconcile popup
  miscCard?: boolean; // a planned-misc spend card: an ordinary dated bill whose Pay button logs a spend
  deferred?: boolean; // a wind-down-overhang expense: paid by its assignee at wind-down, out of the settlement
  cardBill?: boolean; cardId?: number; cycleEndISO?: string; dueISO?: string; // a family credit-card bill (paid from held cash; net-neutral like a fund bill)
  cardPersonal?: number; cardAnnualFee?: number; cardColor?: string; // the owner's personal slice + annual fee (fee-month only) + the card's colour — for the Pay modal
  cardFamilyBudgeted?: number; cardFamilyMisc?: number; // family portion split: from held budget vs from in-hand
};
// An allowance = personal money the treasurer SENDS a member (not a bill they owe). Disbursed after
// collection, never dated/overdue; completion writes through to the Sheet line's paid flag (billId).
export type PlanAllowance = { key: string; recipientId: number; recipientName: string; label?: string; amount: number; done: boolean; billId: number; day?: number | null; status?: "overdue" | "soon" | "normal" | null; days?: number | null;
  // Two-step pool-funded misc: after the hub → member disbursement (this allowance), the member pays the
  // vendor — a second, independently-tickable leg emitted from the same Sheet row (done = vendorPaid).
  vendorLeg?: { vendor: string; vendorPaid: boolean; day?: number | null } | null };
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
  kind: "transfer-in" | "transfer-out" | "bill" | "allowance" | "piggy" | "advance" | "income" | "manual" | "pool-handover";
  recordIds?: number[]; // pool-handover: the PoolHandover row ids this combined step ticks handed-over
  manualId?: number; // this step is a head-added manual move (write-through to the ManualPlanStep record)
  afterStepKey?: string; // a manual step: the step id it's anchored right after (for stable positioning)
  hidden?: boolean; // a head-hidden derived step — kept for the "un-hide" list but out of the walk/progress
  day: number | null; // effective day-of-month for ordering/display (null = undated)
  paidDay?: number | null; // day-of-month it was ACTUALLY marked paid (done steps only), for a "paid <day>" tag
  amount: number;
  done: boolean;
  // income (informational: a member's own income landing — credits their cash in the walk, not tickable)
  source?: string; // the income line's label (e.g. "Salary", "Rent")
  incomeId?: number; // the IncomeEntry id — lets the head edit the arrival day from the plan
  handoverPeriodId?: number; // piggy hand-over step: the wound-down period whose leftover is being handed over (ticking marks it handed over)
  // transfer
  poolTwoStep?: boolean; // leg 1 of a two-step pool-funded misc: the member RETAINS this until they pay the vendor (leg 2), so unlike a plain allowance the receiver's holding IS adjusted
  poolVendorLeg?: boolean; // leg 2 of a two-step pool-funded misc: the member → vendor payment (ticked separately)
  fromId?: number; toId?: number; fromName?: string; toName?: string; recordId?: number | null; feedsBills?: boolean;
  fundsMember?: boolean; // a disbursement piece timed to fund the recipient's own bills below
  advanceId?: number; // this step is a funding advance (write-through to the Advance record)
  payback?: boolean; // this advance step is the PAYBACK leg (borrower → funder), not the front
  reimbursement?: boolean; // a disbursement that pays a member back for prior-month out-of-pocket spends (scheduled early)
  reroute?: boolean; // a disbursement paid DIRECT by a debtor (not via the hub) because the hub couldn't fund it in time
  budgetLoan?: boolean; // a member lends their RETAINED BUDGET (beyond their net) to fund a bill early — a round-trip loan
  budgetPayback?: boolean; // the hub returns a budget loan to its lender, once later income leaves the hub a surplus
  returnBy?: number | null; // on a budgetLoan front: the day the hub repays it (shown as "returned by the Nth")
  infeasibleFrom?: number | null; // on a short BILL: the earliest day its payer can actually settle it ("payable from day Y"); null = not this month
  // bill
  payerId?: number | null; payerName?: string; vendor?: string; billId?: number; categoryId?: number; fund?: boolean; fundAvail?: number; misc?: boolean; deferred?: boolean;
  miscCard?: boolean; // a planned-misc spend card: paid by logging a spend against its category (categoryId)
  // A family credit-card bill: paid from cash the owner already HOLDS (carried budget / reimbursed misc),
  // so — like a fund bill — it's net-neutral in the walk (never "short"). cardId + cycleEndISO identify
  // the cycle for the Pay action; dueISO is the statement due date.
  cardBill?: boolean; cardId?: number; cycleEndISO?: string; dueISO?: string;
  cardPersonal?: number; cardAnnualFee?: number; cardColor?: string; // the owner's personal slice + annual fee (fee-month only) + the card's colour — for the Pay modal
  cardFamilyBudgeted?: number; cardFamilyMisc?: number; // family portion split: from held budget vs from in-hand
  status?: "overdue" | "soon" | "normal" | null;
  days?: number | null; // days until due (negative = overdue), for the urgency tag
  short?: number; // hub is short this much when this step runs (funds not in yet)
  hubAfter?: number; // treasurer's running settlement balance right after this step (hub steps only)
  actorLeft?: number; // for a member's own step: how much they still have to pay out after this
  balancesBefore?: Record<number, number>; // every member's cash right BEFORE this step runs
  balancesAfter?: Record<number, number>; // every member's running cash position right after this step
  senderShort?: number; // the step's sender can't cover it from cash-in-hand yet — short by this much
};

export type MoneyPlan = { steps: PlanStep[]; done: number; total: number; hubShortfall: number; shortBills: number };

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
  piggyHandover?: { toId: number; toName: string; handoverPeriodId: number; owners: { fromId: number; fromName: string; amount: number; day: number; status?: "overdue" | "soon" | "normal" | null; days?: number | null }[] }; // prior wound-down month's leftover — one tickable step per owner who hands their slice to the Piggy holder
  manualSteps?: { id: number; fromId: number; toId: number; fromName?: string; toName?: string; amount: number; day?: number | null; done: boolean; afterStepKey?: string | null }[]; // head-added ad-hoc moves
  poolHandovers?: { fromId: number; fromName: string; toId: number; toName: string; amount: number; detail: string; recordIds: number[]; done: boolean; day: number | null; status?: "overdue" | "soon" | "normal" | null; days?: number | null }[]; // prior-month cash (leftover→income and/or Piggy→income) a holder hands to the treasurer
  hiddenKeys?: string[]; // step ids the head has hidden from the plan view
  orderOverrides?: Record<string, number>; // head "move up/down": step id → manual sort index (overrides day/rank order)
}): MoneyPlan {
  const { treasurerId, treasurerName, transfers, bills, allowances = [], piggyReturns = [], advances = [], incomeDayByMember, incomeByMember = {}, incomeArrivals, reimburseByMember = {}, reimburseDay, piggyHandover, manualSteps = [], poolHandovers = [], hiddenKeys = [], orderOverrides = {} } = input;

  const inbound = transfers.filter((t) => t.toId === treasurerId);
  const outbound = transfers.filter((t) => t.toId !== treasurerId && t.fromId === treasurerId); // hub → creditor
  // Paid-so-far on a (possibly PARTIALLY) settled disbursement. An early reimbursement can settle just
  // a SLICE of what the hub owes a creditor (the settlement record holds one amount); the unpaid rest
  // must still be scheduled below, or the creditor's later bills would show unfunded. paidOf clamps to net.
  // Paid-so-far to a creditor = SUM of their settlement payments (per-payment model), clamped to net.
  const paidOf = (o: PlanTransfer) => Math.min(o.paidAmount ?? 0, o.amount);
  // What's already been paid to each creditor (any partial counts, not just fully-settled ones) — used
  // to net down the reimbursement need so an already-paid slice isn't scheduled again.
  const paidByCreditor = new Map<number, number>(outbound.filter((o) => paidOf(o) > 0.005).map((o) => [o.toId, paidOf(o)]));
  // Disbursements happen only after everything has been collected AND the bills paid, so anchor
  // undated/residual outbound transfers to the latest inbound-income day OR bill due-day, whichever
  // is later. Undated bills contribute 0 here — a bill with no due date shouldn't push the payout later.
  const lastDay = Math.max(1, ...inbound.map((t) => incomeDayByMember[t.fromId] ?? 1), ...bills.map((b) => b.day ?? 0));
  const hasHubBills = bills.some((b) => b.payerId === treasurerId && !b.done);
  // Each income event with the day it lands (undated → up front). Shared by the scheduler AND the walk.
  const arrivalList: { memberId: number; day: number | null; amount: number; source?: string; name?: string; id?: number; received?: boolean }[] =
    incomeArrivals ?? Object.entries(incomeByMember).map(([k, v]) => ({ memberId: Number(k), day: null, amount: v }));
  // A tiny chronological accumulator: cashBy(day) = Σ of events landing on/before `day` (undated = day 0).
  const cashBy = (events: { day: number | null; amount: number }[]) => {
    const ev = events.map((e) => ({ day: e.day ?? 0, amount: e.amount }));
    return (upto: number) => ev.reduce((s, e) => (e.day <= upto ? s + e.amount : s), 0);
  };

  // A debtor can only pay the hub once THEIR OWN income has actually covered what they owe — not on
  // their earliest trickle. So date each collection to the first day their cumulative income ≥ their
  // net; if their income never fully covers it (a genuine shortfall), fall back to their earliest
  // income day so the walk still flags it. Fixes e.g. a big earner whose ₹6k advance lands day 1 but
  // whose ₹70k salary (which funds the collection) lands day 2 — the collection belongs on day 2.
  const memberIncomeEvents = (memberId: number) =>
    arrivalList.filter((a) => a.memberId === memberId).map((a) => ({ day: a.day ?? 0, amount: a.amount })).sort((x, y) => x.day - y.day);
  const collectionDay = (memberId: number, amount: number): number | null => {
    let cum = 0;
    for (const e of memberIncomeEvents(memberId)) { cum = Math.round((cum + e.amount) * 100) / 100; if (cum >= amount - 0.005) return e.day || null; }
    return incomeDayByMember[memberId] ?? null;
  };
  const inboundDay = new Map<number, number | null>(inbound.map((t) => [t.fromId, collectionDay(t.fromId, t.amount)]));

  const steps: PlanStep[] = [];
  // Inbound collections: a debtor pays their net to the hub once their income covers it.
  for (const t of inbound) {
    steps.push({
      id: `xfer-${t.fromId}-${t.toId}`, kind: "transfer-in", day: inboundDay.get(t.fromId) ?? null,
      amount: t.amount, done: t.settled, fromId: t.fromId, toId: t.toId, fromName: t.from, toName: t.to,
      recordId: t.recordId, status: t.status ?? null, days: t.days ?? null, feedsBills: hasHubBills,
    });
  }
  // Each recorded payment on a disbursement → its OWN done step (persistent, individually undoable via
  // its recordId). A creditor paid in several slices shows several done lines that don't collapse into
  // one growing figure or reshuffle when you tick the next piece. The unpaid remainder (net − Σpaid) is
  // re-scheduled as pieces via unsettledOut below.
  for (const t of outbound) {
    for (const p of t.payments ?? []) {
      if (p.amount <= 0.005) continue;
      // Keep the paid step exactly WHERE IT WAS SCHEDULED — its key encodes the day
      // (disb/reimb-<creditor>-<hub>-<DAY>-<amount>) — so marking it paid never moves it, even when the
      // actual paid date differs (that shows as a "paid <day>" tag instead). Fallback: the payout slot.
      const keyDay = p.key ? Number(p.key.split("-")[3]) : NaN;
      steps.push({
        id: `paid-${t.toId}-${p.id}`, kind: "transfer-out", day: Number.isFinite(keyDay) ? keyDay : lastDay, amount: Math.round(p.amount * 100) / 100, done: true,
        fromId: t.fromId, toId: t.toId, fromName: t.from, toName: t.to, recordId: p.id,
      });
    }
  }
  for (const b of bills) {
    steps.push({
      id: b.key, kind: "bill", day: b.day, amount: b.amount, done: b.done,
      payerId: b.payerId, payerName: b.payerName, vendor: b.vendor, billId: b.billId, categoryId: b.categoryId, fund: b.fund, fundAvail: b.fundAvail, misc: b.misc, miscCard: b.miscCard, status: b.status, days: b.days ?? null, deferred: b.deferred,
      cardBill: b.cardBill, cardId: b.cardId, cycleEndISO: b.cycleEndISO, dueISO: b.dueISO, cardPersonal: b.cardPersonal, cardAnnualFee: b.cardAnnualFee, cardColor: b.cardColor, cardFamilyBudgeted: b.cardFamilyBudgeted, cardFamilyMisc: b.cardFamilyMisc,
    });
  }
  // Allowances: the treasurer disburses these AFTER collection (like a payout), never dated/overdue.
  // Rendered as "Send → <member>"; ticking one writes through to the Sheet line's paid flag (billId).
  for (const a of allowances) {
    steps.push({
      // dated → sent on that day (in order, liquidity-checked); undated → after collection (last day)
      id: a.key, kind: "allowance", day: a.day ?? lastDay, amount: a.amount, done: a.done,
      fromId: treasurerId ?? undefined, toId: a.recipientId, fromName: treasurerName, toName: a.recipientName, source: a.label,
      billId: a.billId, status: a.status ?? null, days: a.days ?? null, poolTwoStep: !!a.vendorLeg,
    });
    // Two-step pool-funded misc: leg 2 — the member pays the vendor with the cash just disbursed. Emitted
    // as a bill step so it reads "member → vendor" and is tickable (via toggleBillPaid leg=vendor →
    // vendorPaid). It's net-zero in the walk (leg 1 credited the member, this debits them) and never
    // enters settlement/getInHand bills (the row carries note=__poolbill__), so no total shifts.
    if (a.vendorLeg) {
      steps.push({
        id: `poolbill-${a.billId}`, kind: "bill", day: a.day ?? lastDay, amount: a.amount, done: a.vendorLeg.vendorPaid,
        payerId: a.recipientId, payerName: a.recipientName, vendor: a.vendorLeg.vendor, billId: a.billId, poolVendorLeg: true,
        status: null, days: null,
      });
    }
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
  // Income arrivals: each income event shown as its own row on the day it lands, so the plan reads
  // "money in → money out" (income first, expense next). It explains the balance walk (the recipient's
  // cash visibly jumps here) and is tickable "received" purely for visual closure (strike-through) —
  // still NOT counted in progress (excluded below), since income isn't a task the family performs.
  arrivalList.forEach((a, i) => {
    if (a.amount <= 0.005) return;
    steps.push({
      id: `income-${a.memberId}-${i}`, kind: "income", day: a.day, amount: Math.round(a.amount * 100) / 100, done: a.received ?? false,
      toId: a.memberId, toName: a.name, source: a.source, incomeId: a.id, status: null, days: null,
    });
  });
  // Pool hand-overs (📥): prior-month cash a member still HOLDS that became this month's pool income —
  // their budget leftover routed to income and/or the general Piggy taken as income. One combined
  // "holder → treasurer" step per holder, dated early so the hub has it before disbursing. Real cash
  // (the holder is seeded with it below, so no false shortfall), tickable, and counted in progress.
  for (const p of poolHandovers) {
    steps.push({
      id: `poolho-${p.fromId}`, kind: "pool-handover", day: p.day, amount: Math.round(p.amount * 100) / 100, done: p.done,
      fromId: p.fromId, toId: p.toId, fromName: p.fromName, toName: p.toName, source: p.detail, recordIds: p.recordIds,
      status: p.status ?? null, days: p.days ?? null,
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
  // Prior wound-down month's Piggy hand-over: one tickable combined lump (owners → Piggy holder),
  // dated to the given day (day 1 by default). It's PRIOR-month cash tracked in In-Hand, so it does
  // NOT move this month's cash walk — it's a to-do that, when ticked, marks the month handed over.
  if (piggyHandover) {
    for (const o of piggyHandover.owners) {
      if (o.amount <= 0.005) continue;
      steps.push({
        id: `piggyho-${piggyHandover.handoverPeriodId}-${o.fromId}`, kind: "piggy", day: o.day, amount: Math.round(o.amount * 100) / 100, done: false,
        fromId: o.fromId, fromName: o.fromName, toId: piggyHandover.toId, toName: piggyHandover.toName,
        handoverPeriodId: piggyHandover.handoverPeriodId, status: o.status ?? null, days: o.days ?? null,
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
  // Remainder still owed to each creditor = net − Σ payments (uniform for un-paid and part-paid alike).
  const unsettledOut = outbound
    .map((o) => ({ ...o, settled: false, amount: Math.round((o.amount - paidOf(o)) * 100) / 100 }))
    .filter((o) => o.amount > 0.005);
  // ALL of a member's cash bills, with their paid flag — a DONE bill already consumed their cash (so it
  // still counts against their liquidity), but only an UNPAID one can generate a funding need.
  // Deferred (wind-down) bills are the assignee's own responsibility, NOT pool-funded — exclude them
  // from need/spare math so they never pull a disbursement; the balance walk still flags them if short.
  const cashBillsOf = (memberId: number) => bills.filter((b) => !b.fund && !b.deferred && !b.cardBill && b.payerId === memberId).map((b) => ({ day: b.day ?? lastDay, amount: -b.amount, done: b.done }));
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
    ...inbound.map((t) => ({ day: inboundDay.get(t.fromId) ?? null, amount: t.amount })),
    // An UNDATED bill has no deadline, so it can't pull the hub's cash early — treat it as month-end
    // (matches cashBillsOf and the "no date sorts last" display). Without this it counted at day 0.
    ...bills.filter((b) => !b.fund && !b.cardBill && b.payerId === treasurerId).map((b) => ({ day: b.day ?? lastDay, amount: -b.amount })),
    ...outbound.filter((o) => o.settled).map((o) => ({ day: 0 as number | null, amount: -paidOf(o) })), // only what actually left the hub
  ]);
  // A debtor's collection that is instead paid DIRECT to a creditor (see the direct-match pass) never
  // reaches the hub — so the hub's available cash from a given day on must EXCLUDE it. Keyed by the
  // debtor's collection day, since that's when the hub would otherwise have received it.
  const directedByCD = new Map<number, number>();
  const directedUpto = (day: number) => { let s = 0; for (const [cd, a] of directedByCD) if (cd <= day) s += a; return s; };
  const hubAvailBy = (day: number) => hubCashBy(day) - directedUpto(day);
  const hubCanCoverBy = (need: number, from: number, used: number): number | null => {
    for (let d = from; d <= 31; d++) if (hubAvailBy(d) - used >= need - 0.005) return d;
    return null;
  };

  // Debtors who could front cash for a reroute: how much each can safely lend by a given day =
  // cash in hand then − ALL their own cash bills (never leave them short) − what they've already lent,
  // capped by the net they owe the hub anyway (lending replaces that payment).
  const debtorState = inbound.map((t) => ({
    id: t.fromId, name: t.from, netRemaining: t.amount,
    cashBy: cashBy(incomeOf(t.fromId)), ownBills: cashBillsOf(t.fromId).filter((b) => !b.done).reduce((s, b) => s + b.amount, 0), // negative sum, unpaid only
    // The day this debtor's cash is COLLECTED to the hub. Reroute only draws cash they still hold —
    // once collected (need.day ≥ this), the money is the hub's and step 1 already funds from it. Without
    // this cap, cash the hub counted (hubCashBy) would be rerouted a SECOND time, over-emitting the hub.
    collectionDay: inboundDay.get(t.fromId) ?? Infinity,
    lent: 0,
  }));

  // Budget lenders (Rule 1: after the hub, peers): a debtor's RETAINED BUDGET = the cash they hold BEYOND
  // their net + own bills (income they'd keep for their own spends). It can be lent to fund a bill EARLY
  // as a round-trip — they pay the creditor directly now; the hub repays them once later income leaves it
  // a surplus (Rule 2). Unlike a reroute (which is net cash and shrinks their collection), a budget loan
  // is beyond their net: they still pay their full net, and the hub owes them the loan back.
  const budgetState = inbound.map((t) => {
    const cash = cashBy(incomeOf(t.fromId));
    const ownB = cashBillsOf(t.fromId).filter((b) => !b.done).reduce((s, b) => s + b.amount, 0); // negative
    return {
      id: t.fromId, name: t.from,
      // accrued budget by a day = income in hand then − their own bills − their full net owed (clamped ≥0)
      budgetBy: (day: number) => Math.max(0, Math.round((cash(day) + ownB - t.amount) * 100) / 100),
      lent: 0,
    };
  });
  // Budget loans made this pass → aggregated into one front per (lender, creditor, day) and one payback
  // per lender after the loop (Rule 2 timing). Avoids the "two Baala→Harish rows in a row" the raw
  // per-bill loop produced.
  const budgetLoans: { lenderId: number; lenderName: string; creditorId: number; creditorName: string; amount: number; day: number }[] = [];
  let hubReserved = 0; // hub cash reserved for budget paybacks, so two paybacks never claim the same rupee

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
      // Per-payment model: ticking a piece records EXACTLY this slice as one payment (no settleAmount
      // override needed — the tick uses the step's own amount, keyed by its id for double-click safety).
    });
  };
  // Keys of funding pieces already PAID (a settlement payment exists with that key). Their money has
  // gone out and shows as a done line, and owed already excludes it (net − Σpaid) — so we must NOT
  // regenerate the same need as a pending piece, or it'd be a dead "mark done" that re-ticks the same
  // paid row and never clears. The leftover simply flows to the month-end payout instead.
  const paidKeys = new Set<string>();
  for (const o of outbound) for (const p of o.payments ?? []) if (p.key) paidKeys.add(p.key);

  for (const need of allNeeds) {
    // The key emit() would mint for the full hub-funded piece of this need; if it's already paid, skip.
    const fullKey = `${need.reimbursement ? "reimb" : "disb"}-${need.creditorId}-${treasurerId}-${need.day}-${Math.round(need.amount)}`;
    if (paidKeys.has(fullKey)) continue;
    let amt = Math.min(need.amount, owed.get(need.creditorId) ?? 0);
    if (amt <= 0.005) continue;
    const treasurerName2 = treasurerName ?? "Treasurer";
    // A reimbursement is SOFT (hub-only): fund what the hub holds by its day; the rest slides to the
    // month-end payout — never routed direct onto a debtor, never a budget loan, never flagged.
    if (need.reimbursement) {
      const avail = hubAvailBy(need.day) - hubUsed;
      const fromHub = Math.min(amt, Math.max(0, avail));
      if (fromHub > 0.005) { emit(need.creditorId, need.day, fromHub, treasurerId!, treasurerName2, false, false, undefined, true); hubUsed += fromHub; owed.set(need.creditorId, (owed.get(need.creditorId) ?? 0) - fromHub); }
      continue;
    }
    // 1. DIRECT MATCH (fewest transactions): a debtor whose cash is in hand by this day pays the creditor
    //    DIRECTLY, skipping the hub — but ONLY because this creditor has a need TODAY (else the debtor's
    //    cash just goes to the hub via their normal collection). Up to the debtor's net; that much of their
    //    collection then never reaches the hub (tracked in directedByCD so the hub isn't over-credited).
    //    `need.day <= collectionDay` includes the collection day itself: rather than debtor→hub→creditor,
    //    pay debtor→creditor. Largest available first.
    if (amt > 0.005) {
      const canDirect = (d: (typeof debtorState)[number]) =>
        Math.min(d.netRemaining, Math.max(0, d.cashBy(need.day) + d.ownBills - d.lent)); // ownBills is negative
      const matchers = debtorState
        .filter((d) => d.id !== need.creditorId && need.day <= d.collectionDay && canDirect(d) > 0.005)
        .sort((a, b) => canDirect(b) - canDirect(a));
      for (const d of matchers) {
        if (amt <= 0.005) break;
        const lend = Math.min(amt, canDirect(d), owed.get(need.creditorId) ?? 0);
        if (lend > 0.005) {
          emit(need.creditorId, need.day, lend, d.id, d.name, true, true);
          d.lent += lend; d.netRemaining -= lend;
          directedByCD.set(d.collectionDay, (directedByCD.get(d.collectionDay) ?? 0) + lend);
          owed.set(need.creditorId, (owed.get(need.creditorId) ?? 0) - lend); amt -= lend;
        }
      }
    }
    // 2. HUB: fund the rest from the hub's own income + collections it has actually received by this day
    //    (hubAvailBy excludes collections that went direct above, so it's never over-credited).
    if (amt > 0.005) {
      const avail = hubAvailBy(need.day) - hubUsed;
      const fromHub = Math.min(amt, Math.max(0, avail));
      if (fromHub > 0.005) { emit(need.creditorId, need.day, fromHub, treasurerId!, treasurerName2, false, true); hubUsed += fromHub; owed.set(need.creditorId, (owed.get(need.creditorId) ?? 0) - fromHub); amt -= fromHub; }
    }
    // 2b. still short → borrow peers' RETAINED BUDGET (beyond their net) to fund the bill by its due day,
    //     as round-trips (Rule 1: largest spare first). They pay the creditor directly now; the hub repays
    //     them later (scheduled after all bills, below). This is what lets a bill clear ON TIME when the
    //     family's TOTAL cash (incl. budgets) covers it — and makes the residual the family's TRUE gap.
    if (amt > 0.005) {
      const lenders = budgetState
        .filter((b) => b.id !== need.creditorId)
        .map((b) => ({ b, spare: Math.max(0, b.budgetBy(need.day) - b.lent) }))
        .filter((x) => x.spare > 0.005)
        .sort((x, y) => y.spare - x.spare);
      for (const { b } of lenders) {
        if (amt <= 0.005) break;
        const spare = Math.max(0, b.budgetBy(need.day) - b.lent);
        const lend = Math.min(amt, spare, owed.get(need.creditorId) ?? 0);
        if (lend > 0.005) {
          // Record the loan intent only — fronts/paybacks are emitted COMBINED after the loop so several
          // bills funded from the same lender on the same day collapse into one step.
          budgetLoans.push({ lenderId: b.id, lenderName: b.name, creditorId: need.creditorId, creditorName: recOf.get(need.creditorId)!.name, amount: Math.round(lend * 100) / 100, day: need.day });
          b.lent += lend; owed.set(need.creditorId, (owed.get(need.creditorId) ?? 0) - lend); amt -= lend;
        }
      }
    }
    // 3. hub can't cover the rest by this day. DON'T over-emit at the due day — that would paint the
    //    hub→member funding step "short". Instead disburse it on the earliest day the hub can actually
    //    afford it, so every hub piece is fundable. The member's own bill step then carries the gap and
    //    its payable-from day (computed in the balance walk below). Falls back to month-end if nothing
    //    lands in time (shouldn't happen: sheet income ≥ expense).
    if (amt > 0.005) {
      const feasible = hubCanCoverBy(amt, need.day, hubUsed) ?? lastDay;
      emit(need.creditorId, feasible, amt, treasurerId!, treasurerName2, false, true);
      hubUsed += amt; owed.set(need.creditorId, (owed.get(need.creditorId) ?? 0) - amt);
    }
  }
  // Whatever a creditor is still owed beyond their dated needs → one final payout at month-end (this
  // isn't funding a specific bill, so it's NOT a fundsMember piece — it sorts after bills, like a payout).
  for (const [creditorId, left] of owed) {
    if (left <= 0.005) continue;
    emit(creditorId, lastDay, left, treasurerId!, treasurerName ?? "Treasurer", false, false);
  }
  // Budget-loan FRONTS: one combined "lender → creditor" per (lender, creditor, day). A member funding
  // several of the same person's bills on one day shows a SINGLE step, not one per bill.
  const frontAgg = new Map<string, { lenderId: number; lenderName: string; creditorId: number; creditorName: string; day: number; amount: number }>();
  for (const l of budgetLoans) {
    const k = `${l.lenderId}-${l.creditorId}-${l.day}`;
    const e = frontAgg.get(k);
    if (e) e.amount = Math.round((e.amount + l.amount) * 100) / 100;
    else frontAgg.set(k, { ...l });
  }
  const frontSteps = new Map<number, PlanStep[]>(); // lenderId → its front steps, to tag with returnBy
  for (const f of frontAgg.values()) {
    const step: PlanStep = {
      id: `bloan-${f.creditorId}-${f.lenderId}-${f.day}`, kind: "transfer-out", day: f.day, amount: f.amount, done: false,
      fromId: f.lenderId, toId: f.creditorId, fromName: f.lenderName, toName: f.creditorName, recordId: null, fundsMember: true, budgetLoan: true,
    };
    pieces.push(step);
    (frontSteps.get(f.lenderId) ?? frontSteps.set(f.lenderId, []).get(f.lenderId)!).push(step);
  }
  // Budget-loan PAYBACKS (Rule 2): one combined "hub → lender" per lender, on the earliest later day the
  // hub has a surplus AFTER funding every bill. Reserve as we go so two paybacks never claim the same rupee.
  const payAgg = new Map<number, { lenderId: number; lenderName: string; amount: number; day: number }>();
  for (const l of budgetLoans) {
    const e = payAgg.get(l.lenderId);
    if (e) { e.amount = Math.round((e.amount + l.amount) * 100) / 100; e.day = Math.min(e.day, l.day); }
    else payAgg.set(l.lenderId, { lenderId: l.lenderId, lenderName: l.lenderName, amount: l.amount, day: l.day });
  }
  for (const p of payAgg.values()) {
    const pday = hubCanCoverBy(p.amount, p.day + 1, hubUsed + hubReserved) ?? lastDay;
    hubReserved += p.amount;
    pieces.push({
      id: `bpay-${p.lenderId}`, kind: "transfer-out", day: pday, amount: p.amount, done: false,
      fromId: treasurerId ?? undefined, toId: p.lenderId, fromName: treasurerName ?? "Treasurer", toName: p.lenderName, recordId: null, budgetPayback: true,
    });
    for (const front of frontSteps.get(p.lenderId) ?? []) front.returnBy = pday; // "returned by the Nth"
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
    s.kind === "income" ? -1 : (s.kind === "transfer-in" || s.kind === "pool-handover") ? 0 : ((s.kind === "advance" && s.fundsMember) || (s.kind === "transfer-out" && s.fundsMember)) ? 1 : s.kind === "bill" ? (s.poolVendorLeg ? 3.7 : s.deferred ? 3.5 : 2) : s.kind === "piggy" ? 4 : 3;
  // Undated INBOUND collections are gathered UP FRONT (money in before money out) — an unknown income
  // day must never sort a collection AFTER the disbursements/bills it funds, which would make the hub
  // look deeply negative when in truth the cash is simply collected first. Undated bills, disbursements
  // and piggy returns still sink to the very bottom (no deadline = lowest priority).
  const eff = (s: PlanStep) => (s.day == null ? (s.kind === "transfer-in" || s.kind === "income" || s.kind === "pool-handover" ? 0 : Infinity) : s.day);
  steps.sort((a, b) => eff(a) - eff(b) || rank(a) - rank(b) || b.amount - a.amount);

  // Head edits, persisted so a refresh keeps them. HIDDEN: mark the derived step in place — it's skipped
  // by the balance walk & progress below, and surfaced separately in the UI so it can be un-hidden.
  const hiddenSet = new Set(hiddenKeys);
  for (const s of steps) if (hiddenSet.has(s.id)) s.hidden = true;
  // MANUAL: real member↔member (or ↔ hub) moves. Splice each in right AFTER its anchor step so it holds
  // its slot across refreshes; chain-resolve so a manual can sit after another manual. If the anchor is
  // gone (its bill was removed, say) fall back to the manual's own day. afterStepKey null → top.
  const manualObjs: PlanStep[] = manualSteps.map((m) => ({
    id: `manual-${m.id}`, kind: "manual", day: m.day ?? null, amount: Math.round(m.amount * 100) / 100, done: m.done,
    fromId: m.fromId, toId: m.toId, fromName: m.fromName, toName: m.toName, manualId: m.id, afterStepKey: m.afterStepKey ?? undefined, status: null, days: null,
  }));
  const pendingManual = manualObjs.slice();
  let manualGuard = 0;
  while (pendingManual.length && manualGuard++ < 2000) {
    let moved = false;
    for (let i = pendingManual.length - 1; i >= 0; i--) {
      const m = pendingManual[i];
      if (m.afterStepKey == null) { steps.unshift(m); pendingManual.splice(i, 1); moved = true; continue; }
      const idx = steps.findIndex((s) => s.id === m.afterStepKey);
      if (idx >= 0) { steps.splice(idx + 1, 0, m); pendingManual.splice(i, 1); moved = true; }
    }
    if (!moved) break;
  }
  for (const m of pendingManual) { // anchor missing → place by day
    let pos = steps.length;
    for (let i = 0; i < steps.length; i++) if ((steps[i].day ?? 0) <= (m.day ?? 0)) pos = i + 1;
    steps.splice(pos, 0, m);
  }

  // Head MANUAL ordering (move up/down): reorders steps ONLY WITHIN their day — the DATE is always the
  // primary sort key (eff), so a step never jumps across dates via an override. Moving up/down past a
  // day boundary changes the step's date instead (setStepDay), and then eff re-sorts it into that day.
  // This keeps "always sort by date" true even after a date edit on an overridden step.
  if (Object.keys(orderOverrides).length) {
    const derived = new Map(steps.map((s, i) => [s.id, i]));
    const ord = (s: PlanStep) => orderOverrides[s.id] ?? derived.get(s.id)!;
    steps.sort((a, b) => eff(a) - eff(b) || ord(a) - ord(b));
  }

  // Per-actor "still to pay" for the member chip: a pure running sum of that person's own outgoing
  // steps (their transfer to the hub + the bills they pay), decremented as the plan proceeds. Since
  // it's derived only from the plan's own steps it can't drift from anything. The treasurer is shown
  // via the hub balance above, so they're excluded here.
  const actorOf = (s: PlanStep): number | null => (s.hidden ? null : s.kind === "bill" ? s.payerId ?? null : s.fromId ?? null);
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
  // Seed each pool-handover holder with the prior-month cash they physically START holding (their
  // leftover / Piggy that became this month's pool income). This lets the hand-over move real balance
  // to the hub — crediting the pool income so the hub can disburse — WITHOUT flagging the holder short.
  for (const p of poolHandovers) shift(p.fromId, p.amount);
  // Seed each card-bill payer with the carried cash they've HELD since the swipe (a credit spend never
  // left their hand — it's been sitting there since a prior month). This is the cash the card bill draws
  // from, so paying it visibly REDUCES their balance without the walk ever flagging them short. Seed both
  // done and unpaid (a done one's seed + its −amount shift cancel, keeping the walk's flow balance intact).
  for (const b of bills) if (b.cardBill) shift(b.payerId, b.amount);
  const senderOf = (s: PlanStep): number | null => (s.kind === "bill" ? s.payerId ?? null : s.fromId ?? null);
  const touchesHub = (s: PlanStep): boolean =>
    treasurerId != null &&
    ((s.kind === "bill" && !s.fund && !s.cardBill && s.payerId === treasurerId) ||
      (s.kind === "income" && s.toId === treasurerId) ||
      ((s.kind === "transfer-in" || s.kind === "transfer-out" || s.kind === "allowance" || s.kind === "advance" || s.kind === "manual" || s.kind === "pool-handover") && (s.fromId === treasurerId || s.toId === treasurerId)));
  let hubShortfall = 0;
  for (const s of steps) {
    s.balancesBefore = Object.fromEntries(bal); // snapshot each person's cash BEFORE this step moves any
    if (s.hidden) { s.balancesAfter = Object.fromEntries(bal); continue; } // removed from the plan → moves nothing
    // Fund bills draw a held fund → net-neutral (no month cash). A card bill DOES move cash, but from the
    // seeded carried cash the payer already holds — so it reduces their balance yet is never "short"
    // (the short-check below skips it; the seed above guarantees the cash is there).
    const usesCash = !(s.kind === "bill" && s.fund);
    const senderId = senderOf(s);
    if (!s.done && usesCash && senderId != null && !s.cardBill) {
      const before = bal.get(senderId) ?? 0;
      if (before < s.amount - 0.005) {
        const short = Math.round((s.amount - before) * 100) / 100;
        // A shortfall is ONLY ever shown on the payer's own BILL step — that's the money they can't yet
        // cover. A member↔member (or hub→member) TRANSFER never shows "short": a sender can't move cash
        // they don't hold, so any gap surfaces on the bill it was meant to fund, not on the transfer.
        // (hubShortfall is kept as an internal safety signal only; it's not rendered on transfers.)
        if (s.kind === "bill") s.senderShort = short;
        else if (senderId === treasurerId) hubShortfall = Math.max(hubShortfall, short);
      }
    }
    if (s.kind === "income") {
      shift(s.toId, s.amount); // income lands in the recipient's hand (always — not gated by a done flag)
    } else if (s.kind === "piggy") {
      // Piggy hand-over = PRIOR-month cash (tracked in In-Hand), informational in the cash walk here — it
      // moves no running balance.
    } else if (s.kind === "transfer-in" || s.kind === "transfer-out" || s.kind === "allowance" || s.kind === "advance" || s.kind === "manual" || s.kind === "pool-handover") {
      shift(s.fromId, -s.amount);
      shift(s.toId, s.amount);
    } else if (s.kind === "bill" && !s.fund) {
      // Normal bill → paid to a vendor (leaves the family). Card bill → paid to the card issuer, drawn
      // from the seeded carried cash; either way the payer's running balance drops by the amount.
      shift(s.payerId, -s.amount);
    }
    s.balancesAfter = Object.fromEntries(bal);
    if (touchesHub(s)) s.hubAfter = bal.get(treasurerId!) ?? 0;
  }

  // Each SHORT bill's payable-from day: the first later step after which the payer's running balance is
  // back to ≥ 0 — i.e. enough income + hub funding + peer help has landed to clear everything up to and
  // including that bill. Since sheet income ≥ expense this resolves to some day this month. Reuses
  // `infeasibleFrom` on the bill = "payable from day Y". `shortBills` counts them — the plan's headline
  // number, which we want to drive to zero.
  const shortBillSteps = steps.filter((s) => s.kind === "bill" && !s.fund && !s.cardBill && !s.done && (s.senderShort ?? 0) > 0.005);
  for (const bill of shortBillSteps) {
    const m = bill.payerId;
    if (m == null) continue;
    const start = steps.indexOf(bill);
    let feasible: number | null = null;
    for (let j = start; j < steps.length; j++) {
      if ((steps[j].balancesAfter?.[m] ?? 0) >= -0.005) { feasible = steps[j].day ?? null; break; }
    }
    bill.infeasibleFrom = feasible;
  }

  // Income rows are informational and Piggy returns are live projections (finalised at wind-down), so
  // neither counts toward the "N/total done" progress — they're context, not tickable settlement steps.
  const counted = steps.filter((s) => s.kind !== "piggy" && s.kind !== "income" && !s.hidden);
  const done = counted.filter((s) => s.done).length;
  return { steps, done, total: counted.length, hubShortfall: Math.round(hubShortfall), shortBills: shortBillSteps.length };
}

// Cash-move step kinds that shift a member's actual holding when completed: income lands in a hand,
// and transfers/allowances/advances/manual moves relocate cash. BILLS are excluded on purpose — the
// In-Hand card already treats an unpaid bill as cash the payer still HOLDS, so it's live without an
// adjustment; and fund bills / Piggy steps move no member cash. See pendingCashMoveByMember.
const CASH_MOVE_KINDS = new Set(["income", "transfer-in", "transfer-out", "allowance", "advance", "manual", "pool-handover"]);

// Per-member sum of the cash-moves NOT yet completed, signed from that member's view (+ if they'd
// RECEIVE it, − if they'd SEND it). Subtracting this from a member's projected In-Hand total gives
// their "holding now" — what they physically hold given only the steps done so far. When every step is
// done the sum is 0 (holding-now == projection); at month start it backs the total down to the carried
// stock. Excludes hidden and already-done steps.
//
// ALLOWANCES (personal-expense money the treasurer sends a member) are special. A plain allowance is
// spending money, not retained holding, so the RECEIVER is NOT adjusted (adjusting would double-count it
// downward); the treasurer still physically holds every undisbursed allowance, so the SENDER keeps the
// −amount (except a self-allowance, from == to, excluded for everyone). A TWO-STEP pool-funded misc is
// different: the member RECEIVES the cash (leg 1) and holds it until they pay the vendor (leg 2), so the
// receiver IS credited for leg 1 and debited for leg 2 (a poolVendorLeg bill) — which is why bills, though
// normally excluded, are counted for that one case. Both legs undone cancel (nothing received yet); leg 1
// done + leg 2 pending leaves the member holding the amount, exactly as they physically do.
export function pendingCashMoveByMember(steps: PlanStep[]): Record<number, number> {
  const out = new Map<number, number>();
  const bump = (id: number | null | undefined, d: number) => {
    if (id == null) return;
    out.set(id, Math.round(((out.get(id) ?? 0) + d) * 100) / 100);
  };
  for (const s of steps) {
    if (s.done || s.hidden) continue;
    const isVendorLeg = s.kind === "bill" && s.poolVendorLeg; // leg 2: member → vendor (a bill, but a real cash move here)
    if (!CASH_MOVE_KINDS.has(s.kind) && !isVendorLeg) continue;
    if (s.kind === "income") { bump(s.toId, s.amount); continue; }
    if (s.kind === "allowance") {
      if (s.fromId != null && s.fromId !== s.toId) bump(s.fromId, -s.amount); // sender holds it
      if (s.poolTwoStep) bump(s.toId, s.amount); // two-step: the receiver RETAINS it until they pay the vendor
      continue;
    }
    if (isVendorLeg) { bump(s.payerId, -s.amount); continue; } // member → vendor: leaves the member's hand
    bump(s.fromId, -s.amount);
    bump(s.toId, s.amount);
  }
  return Object.fromEntries(out);
}
