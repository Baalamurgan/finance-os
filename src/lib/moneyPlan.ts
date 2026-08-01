// The Money Plan (Phase B): a single ORDERED, DATED choreography of the month's money movements,
// derived purely from records that already exist — settlement transfers (who → the treasurer hub)
// and dated bill payments. It invents no new money: the "remainder back to a member" transfers
// already fall out of the settlement net math; the plan just places everything in time so the
// family can execute it step by step. Completion is written through to the underlying records
// (SettlementRecord / bill paid) elsewhere, so this stays a projection, never a second ledger.

export type PlanTransfer = { fromId: number; from: string; toId: number; to: string; amount: number; settled: boolean; recordId: number | null };
export type PlanBill = {
  key: string; payerId: number | null; payerName: string; vendor: string; amount: number; done: boolean;
  day: number | null; status: "overdue" | "soon" | "normal" | null; billId?: number; categoryId?: number; fund?: boolean; fundAvail?: number;
};

export type PlanStep = {
  id: string;
  kind: "transfer-in" | "transfer-out" | "bill";
  day: number | null; // effective day-of-month for ordering/display (null = undated)
  amount: number;
  done: boolean;
  // transfer
  fromId?: number; toId?: number; fromName?: string; toName?: string; recordId?: number | null;
  // bill
  payerId?: number | null; payerName?: string; vendor?: string; billId?: number; categoryId?: number; fund?: boolean; fundAvail?: number;
  status?: "overdue" | "soon" | "normal" | null;
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
  const lastDay = Math.max(1, ...inbound.map((t) => incomeDayByMember[t.fromId] ?? 1), ...bills.map((b) => b.day ?? 1));

  const steps: PlanStep[] = [];
  for (const t of transfers) {
    const isIn = t.toId === treasurerId;
    steps.push({
      id: `xfer-${t.fromId}-${t.toId}`,
      kind: isIn ? "transfer-in" : "transfer-out",
      // inbound arrives when the payer's income lands; outbound (disbursement) after collection
      day: isIn ? incomeDayByMember[t.fromId] ?? 1 : lastDay,
      amount: t.amount, done: t.settled,
      fromId: t.fromId, toId: t.toId, fromName: t.from, toName: t.to, recordId: t.recordId,
    });
  }
  for (const b of bills) {
    steps.push({
      id: b.key, kind: "bill", day: b.day, amount: b.amount, done: b.done,
      payerId: b.payerId, payerName: b.payerName, vendor: b.vendor, billId: b.billId, categoryId: b.categoryId, fund: b.fund, fundAvail: b.fundAvail, status: b.status,
    });
  }

  // Ideal order: by effective day, then income-in → bills → disbursements-out (money comes in,
  // bills get paid, remainder flows back). Undated steps assume the 1st.
  const rank = (s: PlanStep) => (s.kind === "transfer-in" ? 0 : s.kind === "bill" ? 1 : 2);
  steps.sort((a, b) => (a.day ?? 1) - (b.day ?? 1) || rank(a) - rank(b) || b.amount - a.amount);

  // Feasibility: walk the treasurer's running balance. Inbound transfers add; bills the treasurer
  // pays and disbursements subtract. If an outflow runs before enough has arrived, flag the gap.
  let hub = 0;
  let hubShortfall = 0;
  for (const s of steps) {
    if (s.kind === "transfer-in") hub += s.amount;
    else if (s.kind === "transfer-out") { hub -= s.amount; if (hub < -0.005) { s.short = Math.round(-hub); hubShortfall = Math.max(hubShortfall, -hub); } }
    else if (s.kind === "bill" && s.payerId === treasurerId) { hub -= s.amount; if (hub < -0.005) { s.short = Math.round(-hub); hubShortfall = Math.max(hubShortfall, -hub); } }
  }

  const done = steps.filter((s) => s.done).length;
  return { steps, done, total: steps.length, hubShortfall: Math.round(hubShortfall) };
}
