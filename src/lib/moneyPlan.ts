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

export type PlanStep = {
  id: string;
  kind: "transfer-in" | "transfer-out" | "bill";
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
};

export type MoneyPlan = { steps: PlanStep[]; done: number; total: number; hubShortfall: number };

export function buildMoneyPlan(input: {
  treasurerId: number | null;
  transfers: PlanTransfer[];
  bills: PlanBill[];
  incomeDayByMember: Record<number, number>; // earliest arrival day per member
}): MoneyPlan {
  const { treasurerId, transfers, bills, incomeDayByMember } = input;

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

  // Display order: by due date (soonest first), then income-in → bills → disbursements-out as the
  // within-day tie-break (money comes in, bills get paid, remainder flows back). Anything with NO
  // due date is the lowest priority — it sinks to the very bottom.
  const rank = (s: PlanStep) => (s.kind === "transfer-in" ? 0 : s.kind === "bill" ? 1 : 2);
  const eff = (s: PlanStep) => (s.day == null ? Infinity : s.day);
  steps.sort((a, b) => eff(a) - eff(b) || rank(a) - rank(b) || b.amount - a.amount);

  // Feasibility: walk the treasurer's running balance in the order money actually MOVES (by day),
  // with the remainder-out pinned to the end and undated bills paid just before it (they have no
  // deadline, so they don't create a false "money not in yet" gap). Inbound adds; treasurer-paid
  // bills and disbursements subtract. If an outflow runs before enough has arrived, flag the gap.
  const walkOrder = [...steps].sort((a, b) => {
    const wa = a.kind === "transfer-out" ? 1e9 : a.day == null ? 1e8 : a.day;
    const wb = b.kind === "transfer-out" ? 1e9 : b.day == null ? 1e8 : b.day;
    return wa - wb || rank(a) - rank(b);
  });
  let hub = 0;
  let hubShortfall = 0;
  for (const s of walkOrder) {
    if (s.kind === "transfer-in") hub += s.amount;
    else if (s.kind === "transfer-out") { hub -= s.amount; if (hub < -0.005) { s.short = Math.round(-hub); hubShortfall = Math.max(hubShortfall, -hub); } }
    else if (s.kind === "bill" && s.payerId === treasurerId) { hub -= s.amount; if (hub < -0.005) { s.short = Math.round(-hub); hubShortfall = Math.max(hubShortfall, -hub); } }
  }

  const done = steps.filter((s) => s.done).length;
  return { steps, done, total: steps.length, hubShortfall: Math.round(hubShortfall) };
}
