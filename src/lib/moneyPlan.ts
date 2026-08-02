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

export type PlanStep = {
  id: string;
  kind: "transfer-in" | "transfer-out" | "bill" | "allowance";
  day: number | null; // effective day-of-month for ordering/display (null = undated)
  amount: number;
  done: boolean;
  // transfer
  fromId?: number; toId?: number; fromName?: string; toName?: string; recordId?: number | null; feedsBills?: boolean;
  // bill
  payerId?: number | null; payerName?: string; vendor?: string; billId?: number; categoryId?: number; fund?: boolean; fundAvail?: number;
  status?: "overdue" | "soon" | "normal" | null;
  days?: number | null; // days until due (negative = overdue), for the urgency tag
  short?: number; // hub is short this much when this step runs (funds not in yet)
  hubAfter?: number; // treasurer's running settlement balance right after this step (hub steps only)
  actorLeft?: number; // for a member's own step: how much they still have to pay out after this
};

export type MoneyPlan = { steps: PlanStep[]; done: number; total: number; hubShortfall: number };

export function buildMoneyPlan(input: {
  treasurerId: number | null;
  treasurerName?: string;
  transfers: PlanTransfer[];
  bills: PlanBill[];
  allowances?: PlanAllowance[];
  incomeDayByMember: Record<number, number>; // earliest arrival day per member
}): MoneyPlan {
  const { treasurerId, treasurerName, transfers, bills, allowances = [], incomeDayByMember } = input;

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

  // Display order: by due date (soonest first), then income-in → bills → disbursements-out as the
  // within-day tie-break (money comes in, bills get paid, remainder flows back). Anything with NO
  // due date is the lowest priority — it sinks to the very bottom.
  // income in (0) → bills (1) → disbursements + allowances out (2), all after collection
  const rank = (s: PlanStep) => (s.kind === "transfer-in" ? 0 : s.kind === "bill" ? 1 : 2);
  const eff = (s: PlanStep) => (s.day == null ? Infinity : s.day);
  steps.sort((a, b) => eff(a) - eff(b) || rank(a) - rank(b) || b.amount - a.amount);

  // Hub (treasurer) running balance, walked in DISPLAY order = the settlement cash collected minus
  // paid out, so far. Starts at 0 (before any collection this month). Inbound adds; the treasurer's
  // own bills and the disbursements-out subtract; member-paid bills never touch the hub. If it dips
  // below 0 at any step, the treasurer is short there — money is needed before it has arrived.
  let hub = 0;
  let hubShortfall = 0;
  for (const s of steps) {
    if (s.kind === "transfer-in") { hub += s.amount; s.hubAfter = hub; }
    else if (s.kind === "transfer-out" || s.kind === "allowance") { hub -= s.amount; s.hubAfter = hub; }
    // A fund bill is paid from its own sinking fund (net-neutral to the hub), so it never draws the
    // treasurer's collected cash — exclude it, else dating it early would flag a phantom shortfall.
    else if (s.kind === "bill" && s.payerId === treasurerId && !s.fund) { hub -= s.amount; s.hubAfter = hub; }
    if (s.hubAfter != null && s.hubAfter < -0.005) { s.short = Math.round(-s.hubAfter); hubShortfall = Math.max(hubShortfall, -s.hubAfter); }
  }

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

  const done = steps.filter((s) => s.done).length;
  return { steps, done, total: steps.length, hubShortfall: Math.round(hubShortfall) };
}
