// Wind-down "where the money goes" — how each budgeted category's leftover / overspend is settled at
// month-end, with the family's saved GROUPS (WindDownChoice). Pure planner (unit-tested) + a loader.
//
// Rules (from Nov 2026 month-end on; agreed 2026-11-03 / 2026-11-08):
//   • the month's spare balance (carry-in + income − sheet expenses) always goes to next month's income;
//     it never absorbs overspend;
//   • a group's leftovers cover its overspends first (each leftover category gives in proportion to its
//     leftover); what's still over is CUT from next month's budgets (split editable, must add up), what's
//     still left goes to the group's destination (Piggy or next month's income);
//   • a budget HOLDER gets back what they spent over in next month's settlement ("↩ overspend you paid"),
//     and a holder whose leftover covered someone's overspend is charged it ("leftover you hold");
//   • a cut never takes a category below 0 next month — what can't fit comes off next month's income.
// A category with no saved group is a group of one, leftover → Piggy.

export const GROUP_RULE_FROM = { year: 2026, month: 11 } as const;
export const groupRuleActive = (year: number, month: number) => year * 12 + month >= GROUP_RULE_FROM.year * 12 + GROUP_RULE_FROM.month;

export type Destination = "piggy" | "income";
export type PlanRow = { categoryId: number; name: string; planned: boolean; budget: number; spent: number; holderId: number | null };
export type CutTarget = { categoryId: number; name: string; capacity: number }; // a regular budget next month
export type SavedChoice = { categoryIds: number[]; destination: Destination; cuts: { categoryId: number; amount: number }[] | null };

export type GroupPlan = {
  key: string;
  categoryIds: number[];
  rows: PlanRow[];
  saved: boolean; // from a saved choice (vs an automatic group of one)
  destination: Destination;
  budget: number;
  spent: number;
  over: number;    // net overspend after leftovers covered what they could (0 if none)
  left: number;    // net leftover after covering (0 if none)
  covered: number; // overspend covered by the group's own leftovers
  cuts: { categoryId: number; name: string; amount: number }[]; // next month's budget cuts (sum + overflow = over)
  overflow: number; // part of `over` no budget could take → comes off next month's income
  needsTarget: boolean; // a planned card's overspend had no regular budget to go on (the user should pick one)
  leftoverTo: { categoryId: number; amount: number }[]; // per category, what goes to `destination`
  credits: { holderId: number; categoryId: number; name: string; amount: number }[]; // ↩ overspend you paid
  holds: { holderId: number; categoryId: number; name: string; amount: number }[];   // leftover you hold (used to cover)
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export function planWindDown(rows: PlanRow[], targets: CutTarget[], choices: SavedChoice[]): { groups: GroupPlan[]; cutByCat: Map<number, number>; overflow: number } {
  const byId = new Map(rows.filter((r) => r.budget > 0).map((r) => [r.categoryId, r]));
  const targetById = new Map(targets.map((t) => [t.categoryId, t]));
  const capLeft = new Map(targets.map((t) => [t.categoryId, Math.max(0, t.capacity)]));
  const used = new Set<number>();

  const groupsIn: { rows: PlanRow[]; saved: boolean; destination: Destination; cuts: SavedChoice["cuts"] }[] = [];
  for (const c of choices) {
    const members = c.categoryIds.map((id) => byId.get(id)).filter((r): r is PlanRow => !!r && !used.has(r.categoryId));
    if (members.length === 0) continue;
    members.forEach((r) => used.add(r.categoryId));
    groupsIn.push({ rows: members, saved: true, destination: c.destination === "income" ? "income" : "piggy", cuts: c.cuts });
  }
  for (const r of byId.values()) if (!used.has(r.categoryId)) groupsIn.push({ rows: [r], saved: false, destination: "piggy", cuts: null });

  const cutByCat = new Map<number, number>();
  let overflowTotal = 0;

  // Put `amount` on category `id` up to its remaining next-month budget; returns what didn't fit.
  const take = (id: number, amount: number, out: Map<number, number>) => {
    const cap = capLeft.get(id) ?? 0;
    const a = r2(Math.min(cap, amount));
    if (a > 0) {
      capLeft.set(id, r2(cap - a));
      out.set(id, r2((out.get(id) ?? 0) + a));
    }
    return r2(amount - a);
  };

  const groups: GroupPlan[] = groupsIn.map((g) => {
    const overOf = (r: PlanRow) => Math.max(0, r2(r.spent - r.budget));
    const leftOf = (r: PlanRow) => Math.max(0, r2(r.budget - r.spent));
    const O = r2(g.rows.reduce((t, r) => t + overOf(r), 0));
    const L = r2(g.rows.reduce((t, r) => t + leftOf(r), 0));
    const covered = r2(Math.min(O, L));
    const over = r2(O - covered);
    const left = r2(L - covered);

    // Leftovers used to cover: each leftover category in proportion to its leftover (last one takes the rounding).
    const leftRows = g.rows.filter((r) => leftOf(r) > 0);
    const usedBy = new Map<number, number>();
    let usedSum = 0;
    leftRows.forEach((r, i) => {
      const u = i === leftRows.length - 1 ? r2(covered - usedSum) : r2((covered * leftOf(r)) / L);
      usedBy.set(r.categoryId, u);
      usedSum = r2(usedSum + u);
    });
    const leftoverTo = leftRows.map((r) => ({ categoryId: r.categoryId, amount: r2(leftOf(r) - (usedBy.get(r.categoryId) ?? 0)) })).filter((x) => x.amount > 0.005);
    const holds = leftRows
      .filter((r) => r.holderId != null && (usedBy.get(r.categoryId) ?? 0) > 0.005)
      .map((r) => ({ holderId: r.holderId!, categoryId: r.categoryId, name: r.name, amount: usedBy.get(r.categoryId)! }));
    const credits = g.rows
      .filter((r) => r.holderId != null && overOf(r) > 0.005)
      .map((r) => ({ holderId: r.holderId!, categoryId: r.categoryId, name: r.name, amount: overOf(r) }));

    // Cuts for the net overspend.
    const out = new Map<number, number>();
    let overflow = 0;
    let needsTarget = false;
    if (over > 0.005) {
      const regularInGroup = g.rows.filter((r) => targetById.has(r.categoryId));
      const spillToGroup = (amount: number) => {
        // spread over the group's regular budgets that still have room (in group order)
        let rest = amount;
        for (const r of regularInGroup) {
          if (rest <= 0.005) break;
          rest = take(r.categoryId, rest, out);
        }
        return rest;
      };
      const saved = (g.cuts ?? []).filter((c) => targetById.has(c.categoryId) && c.amount > 0);
      const savedSum = r2(saved.reduce((t, c) => t + c.amount, 0));
      let shares: { categoryId: number; amount: number }[];
      if (savedSum > 0.005) {
        // the edited split; if the month's numbers moved since it was saved, keep its proportions
        const k = Math.abs(savedSum - over) <= 0.5 ? 1 : over / savedSum;
        shares = saved.map((c) => ({ categoryId: c.categoryId, amount: r2(c.amount * k) }));
      } else {
        // automatic: from the overspent categories, in proportion to how much each went over
        const overRows = g.rows.filter((r) => overOf(r) > 0);
        shares = overRows.map((r) => ({ categoryId: r.categoryId, amount: r2((over * overOf(r)) / O) }));
      }
      // fix rounding so the shares add up exactly
      const diff = r2(over - shares.reduce((t, s) => t + s.amount, 0));
      if (shares.length && Math.abs(diff) > 0) shares[shares.length - 1].amount = r2(shares[shares.length - 1].amount + diff);

      for (const s of shares) {
        let rest = s.amount;
        if (targetById.has(s.categoryId)) rest = take(s.categoryId, rest, out);
        else if (regularInGroup.length === 0) needsTarget = true; // a planned card with nowhere to go
        if (rest > 0.005) rest = spillToGroup(rest);
        if (rest > 0.005) overflow = r2(overflow + rest);
      }
    }
    for (const [id, a] of out) cutByCat.set(id, r2((cutByCat.get(id) ?? 0) + a));
    overflowTotal = r2(overflowTotal + overflow);

    const nameOf = (id: number) => targetById.get(id)?.name ?? byId.get(id)?.name ?? "?";
    return {
      key: g.rows.map((r) => r.categoryId).sort((a, b) => a - b).join("-"),
      categoryIds: g.rows.map((r) => r.categoryId),
      rows: g.rows,
      saved: g.saved,
      destination: g.destination,
      budget: r2(g.rows.reduce((t, r) => t + r.budget, 0)),
      spent: r2(g.rows.reduce((t, r) => t + r.spent, 0)),
      over, left, covered,
      cuts: [...out.entries()].map(([categoryId, amount]) => ({ categoryId, name: nameOf(categoryId), amount })),
      overflow, needsTarget, leftoverTo, credits, holds,
    };
  });

  return { groups, cutByCat, overflow: overflowTotal };
}
