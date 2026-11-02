// In-Hand "Held for" coverage — which of a member's pending bills / sends the cash they hold RIGHT NOW
// actually covers. Agreed rules (Nov 2026):
//  • Misc spends never decide coverage — the plan stays solid. Coverage runs on the cash as if the misc
//    hadn't happened (holding + misc), and the misc shows only as its own "− spent" line.
//  • Fixed holdings (budgets left, set-asides, sinking, Piggy, card cash, …) are always held first.
//  • Pending bills AND sends share ONE queue in Money Plan order. An item is covered only if it FULLY fits
//    the cash still unassigned; a partly-covered item holds nothing (the cash stays free for later, smaller
//    items) and waits until the money arrives.
//  • A waiting item whose day has come (due today / overdue) is "short" — still payable (Pay anyway).
import type { PlanStep } from "@/lib/moneyPlan";

export type QueueItem = {
  key: string; // plan step id
  type: "bill" | "send";
  label: string;
  amount: number;
  day: number | null;
  dueNow: boolean; // its day has come (due today / overdue) — a waiting one is "short"
  toName?: string; // send: who it goes to
  toTreasurer?: boolean;
  // bill pay controls
  billId?: number;
  misc?: boolean;
  poolVendorLeg?: boolean;
  cardBill?: { cardId: number; cycleEndISO: string };
};
export type IncomingItem = { key: string; label: string; fromName: string | null; amount: number; day: number | null; fundsBillKey: string | null; billLinked: boolean; income: boolean };

const SEND_KINDS = new Set<PlanStep["kind"]>(["transfer-in", "transfer-out", "allowance", "advance", "manual", "pool-handover"]);

/**
 * A member's pending outflows (queue, in plan order) and pending inflows, from the Money Plan steps.
 * `routedOut` = cash this member already sent to the treasurer by manual steps that SUPERSEDES their
 * canonical pending settlement transfer (see in-hand page: routing) — taken off those transfers first.
 */
export function memberFlows(steps: PlanStep[], memberId: number, treasurerId: number | null, today: number | null, routedOut = 0): { queue: QueueItem[]; incoming: IncomingItem[] } {
  const queue: QueueItem[] = [];
  const incoming: IncomingItem[] = [];
  let routed = routedOut;
  const isDue = (s: PlanStep) => s.status === "overdue" || (s.status === "soon" && s.days === 0) || (today != null && s.day != null && s.day <= today);
  for (const s of steps) {
    if (s.done || s.hidden) continue;
    if (s.kind === "bill") {
      if (s.payerId !== memberId) continue;
      if (s.fund || s.miscCard) continue; // drawn from the fund / paid by logging a spend — not cash in this queue
      queue.push({
        key: s.id, type: "bill", label: s.vendor ?? "Bill", amount: s.amount, day: s.day, dueNow: isDue(s),
        billId: s.billId, misc: s.misc, poolVendorLeg: s.poolVendorLeg,
        cardBill: s.cardBill && s.cardId != null && s.cycleEndISO ? { cardId: s.cardId, cycleEndISO: s.cycleEndISO } : undefined,
      });
      continue;
    }
    if (s.kind === "income") {
      if (s.toId === memberId) incoming.push({ key: s.id, label: s.source || "Income", fromName: null, amount: s.amount, day: s.day, fundsBillKey: null, billLinked: false, income: true });
      continue;
    }
    if (!SEND_KINDS.has(s.kind) || s.fromId == null || s.toId == null || s.fromId === s.toId) continue;
    // Piggy-as-income hand-over: the holder forwards role money (not their own cash) — not in their queue.
    const piggyIncome = s.kind === "pool-handover" && (s.piggyIncomeIds?.length ?? 0) > 0;
    if (s.fromId === memberId && !piggyIncome) {
      let amount = s.amount;
      const toTreasurer = s.toId === treasurerId;
      if (toTreasurer && routed > 0.005 && (s.kind === "transfer-in" || s.kind === "transfer-out" || s.kind === "pool-handover")) {
        const cut = Math.min(amount, routed);
        amount = Math.round((amount - cut) * 100) / 100;
        routed -= cut;
      }
      if (amount > 0.005) queue.push({ key: s.id, type: "send", label: s.source || s.vendor || (toTreasurer ? "Settlement" : "Send"), amount, day: s.day, dueNow: isDue(s), toName: s.toName, toTreasurer });
    } else if (s.toId === memberId) {
      incoming.push({ key: s.id, label: s.source || s.vendor || (s.kind === "allowance" ? "Allowance" : "Transfer"), fromName: s.fromName ?? null, amount: s.amount, day: s.day, fundsBillKey: s.fundsBillKey ?? null, billLinked: !!(s.fundsMember || s.fundsBillKey), income: false });
    }
  }
  return { queue, incoming };
}

export type Covered = QueueItem & { covered: true };
export type Arrival = { amount: number; day: number | null; fromName: string | null; label: string };
export type Waiting = QueueItem & {
  covered: false;
  short: number; // what today's free cash is short of the full amount
  // Every planned inflow it takes to cover it, in date order (an inflow earmarked for this exact item, or
  // the free inflows that add up to it). `stillShort` > 0 = even all of them aren't enough.
  arrivals: Arrival[];
  stillShort: number;
};

/**
 * Allocate `planCash` (holding + misc) to the fixed holdings, then the queue in order.
 * Returns covered/waiting items and `unassigned` (cash left after fixed + covered; may be negative).
 */
export function allocate(planCash: number, fixedTotal: number, queue: QueueItem[], incoming: IncomingItem[]): { items: (Covered | Waiting)[]; unassigned: number } {
  let avail = Math.round((planCash - fixedTotal) * 100) / 100;
  const covered = new Set<string>();
  for (const q of queue) {
    if (q.amount <= avail + 0.005) { covered.add(q.key); avail = Math.round((avail - q.amount) * 100) / 100; }
  }
  const free = Math.max(0, avail);
  // Inflows earmarked for a specific bill (fundsBillKey / a funding piece) only ever answer THAT bill;
  // the "when does money come" walk for everything else uses the free inflows (incomes, plain transfers).
  const byDay = incoming.filter((i) => !i.billLinked).sort((a, b) => (a.day ?? 99) - (b.day ?? 99));
  const items = queue.map((q): Covered | Waiting => {
    if (covered.has(q.key)) return { ...q, covered: true };
    const short = Math.round((q.amount - free) * 100) / 100;
    // What brings the money: an inflow earmarked for this exact item first, else the earliest inflows
    // (with today's free cash) that add up to it.
    // A funding piece without an explicit key is matched by amount, landing on/before the bill's day.
    const linked = incoming.find((i) => i.fundsBillKey === q.key)
      ?? (q.type === "bill" ? incoming.find((i) => i.billLinked && !i.fundsBillKey && Math.abs(i.amount - q.amount) < 0.01 && (i.day ?? 99) <= (q.day ?? 99)) : undefined);
    const toArrival = (i: IncomingItem): Arrival => ({ amount: i.amount, day: i.day, fromName: i.fromName, label: i.label });
    if (linked) return { ...q, covered: false, short, arrivals: [toArrival(linked)], stillShort: 0 };
    const arrivals: Arrival[] = [];
    let run = free;
    for (const i of byDay) {
      if (run + 0.005 >= q.amount) break;
      arrivals.push(toArrival(i));
      run += i.amount;
    }
    return { ...q, covered: false, short, arrivals, stillShort: Math.max(0, Math.round((q.amount - run) * 100) / 100) };
  });
  return { items, unassigned: avail };
}
