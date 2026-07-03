// Pure who-owes-whom math, extracted from getSettlement so it can be unit-tested
// without a database. Each member's net = income they own − (sheet expenses +
// previous-month spends) tagged to them; everyone settles that net with the hub.

export type SettleMember = { id: number; name: string };
export type SettleIncome = { ownerId: number | null; amount: number };
export type SettleTagged = {
  memberId: number | null;
  amount: number;
  label: string;
  category: { name: string };
};
export type SettleRecord = {
  id: number;
  fromMemberId: number;
  toMemberId: number;
  amount: number;
  settledAt: Date | null;
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
    const paidItems = [
      ...expenses
        .filter((e) => e.memberId === m.id)
        .map((e) => ({ label: e.label, amount: e.amount, category: e.category.name, kind: "sheet" as const })),
      ...spends
        .filter((sp) => sp.memberId === m.id)
        .map((sp) => ({
          label: prevLabel ? `${sp.label} (${prevLabel})` : sp.label,
          amount: sp.amount,
          category: sp.category.name,
          kind: "spend" as const,
        })),
    ].sort((a, b) => b.amount - a.amount);
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
          const rec = records.find(
            (s) => s.fromMemberId === base.fromId && s.toMemberId === base.toId,
          );
          return {
            ...base,
            settled: !!rec,
            recordId: rec?.id ?? null,
            settledAt: rec?.settledAt ?? null,
            amountChanged: rec ? Math.abs(rec.amount - base.amount) >= 0.005 : false,
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
