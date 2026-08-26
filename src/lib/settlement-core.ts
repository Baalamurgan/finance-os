// Pure who-owes-whom math, extracted from getSettlement so it can be unit-tested
// without a database. Each member's net = income they own − (sheet expenses +
// previous-month spends) tagged to them; everyone settles that net with the hub.

export type SettleMember = { id: number; name: string };
export type SettleIncome = { ownerId: number | null; amount: number };
export type SettleTagged = {
  memberId: number | null;
  amount: number;
  label: string;
  category: { name: string; responsibleMemberId?: number | null; section?: string | null };
};

// Sheet section order (mirrors the Sheet tab) so the settlement "paid" breakdown reads in the
// same order you see it on the sheet / In-Hand — easy to cross-check line by line.
const SECTION_RANK: Record<string, number> = { Loans: 0, Chits: 1, Monthly: 2, PiggyBudget: 3, Yearly: 4, Misc: 5 };
const sectionRank = (s?: string | null) => SECTION_RANK[s ?? "Monthly"] ?? 9;
export type SettleRecord = {
  id: number;
  fromMemberId: number;
  toMemberId: number;
  amount: number;
  settledAt: Date | null;
  key?: string | null;
};

export function computeSettlement(opts: {
  members: SettleMember[];
  incomes: SettleIncome[];
  expenses: SettleTagged[];
  spends: SettleTagged[];
  records: SettleRecord[];
  treasurerId: number | null;
  prevLabel: string | null;
}) {
  const { members, incomes, expenses, spends, records, treasurerId, prevLabel } = opts;

  const rows = members.map((m) => {
    const contributed = incomes
      .filter((i) => i.ownerId === m.id)
      .reduce((s, i) => s + i.amount, 0);
    // Last month's daily spends credit the spender ONLY for categories that aren't THEIRS
    // (spending your own held budget is already credited via its monthly-share line, so
    // counting the spend too would double-credit). Club them into ONE line per category —
    // the month's sheet already itemises each spend, so the settlement just needs the total.
    const spendByCat = new Map<string, number>();
    for (const sp of spends) {
      if (sp.memberId !== m.id) continue;
      if ((sp.category.responsibleMemberId ?? null) === m.id) continue;
      spendByCat.set(sp.category.name, (spendByCat.get(sp.category.name) ?? 0) + sp.amount);
    }
    // This month's sheet expenses first, in SHEET order (by section, then their input/id order);
    // last month's carried spends sorted to the BOTTOM (amount desc) so it's clear what's this
    // month vs carried, and the top matches the Sheet / In-Hand for cross-checking.
    const sheetItems = expenses
      .filter((e) => e.memberId === m.id)
      .slice()
      .sort((a, b) => sectionRank(a.category.section) - sectionRank(b.category.section))
      .map((e) => ({ label: e.label, amount: e.amount, category: e.category.name, kind: "sheet" as const }));
    const spendItems = [...spendByCat.entries()]
      .map(([category, amount]) => ({
        label: prevLabel ? `${category} (${prevLabel})` : category,
        amount,
        category,
        kind: "spend" as const,
      }))
      .sort((a, b) => b.amount - a.amount);
    const paidItems = [...sheetItems, ...spendItems];
    const paid = paidItems.reduce((s, it) => s + it.amount, 0);
    return { id: m.id, name: m.name, contributed, paid, net: contributed - paid, paidItems };
  });

  const treasurer = members.find((m) => m.id === treasurerId) ?? null;
  const transfers = treasurer
    ? rows
        .filter((r) => r.id !== treasurer.id && Math.abs(r.net) >= 0.005)
        .map((r) => {
          const base =
            r.net > 0
              ? { fromId: r.id, from: r.name, toId: treasurer.id, to: treasurer.name, amount: r.net }
              : { fromId: treasurer.id, from: treasurer.name, toId: r.id, to: r.name, amount: -r.net };
          // Per-payment model: a pair can have SEVERAL payment rows (one per ticked Money-Plan piece).
          // Paid = their sum; the transfer is "settled" only once that sum covers the net. Each payment
          // is carried through so the plan can show it as its own persistent done line with its own undo.
          const recs = records
            .filter((s) => s.fromMemberId === base.fromId && s.toMemberId === base.toId)
            .map((s) => ({ id: s.id, amount: s.amount, settledAt: s.settledAt, key: s.key ?? null }))
            .sort((a, b) => (a.settledAt?.getTime() ?? 0) - (b.settledAt?.getTime() ?? 0));
          const paid = Math.round(recs.reduce((s, x) => s + x.amount, 0) * 100) / 100;
          return {
            ...base,
            settled: paid >= base.amount - 0.005, // fully covered
            payments: recs,
            recordId: recs.length === 1 ? recs[0].id : null, // legacy single-id (one-payment case)
            settledAt: recs.length ? recs[recs.length - 1].settledAt : null,
            paidAmount: paid,
            amountChanged: false,
          };
        })
        .sort((a, b) => b.amount - a.amount)
    : [];

  const settledCount = transfers.filter((t) => t.settled).length;

  return {
    rows,
    treasurer,
    transfers,
    settledCount,
    total: transfers.length,
    allSettled: transfers.length > 0 && settledCount === transfers.length,
  };
}
