import { prisma } from "@/lib/prisma";

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Credit-card dashboard: all-time spend, monthly trend, per-card + per-merchant. */
export async function getCardDashboard(memberId: number) {
  const [cards, txns] = await Promise.all([
    prisma.personalCard.findMany({ where: { memberId, archived: false }, orderBy: { createdAt: "asc" } }),
    prisma.personalCardTxn.findMany({ where: { memberId }, orderBy: { date: "desc" } }),
  ]);
  const cardName = new Map(cards.map((c) => [c.id, c.name]));
  const spends = txns.filter((t) => t.type === "spend");
  const allTime = spends.reduce((s, t) => s + t.amount, 0);

  // monthly totals (continuous range, oldest → newest)
  const byMonth = new Map<string, number>();
  for (const t of spends) {
    const k = `${t.date.getFullYear()}-${String(t.date.getMonth() + 1).padStart(2, "0")}`;
    byMonth.set(k, (byMonth.get(k) ?? 0) + t.amount);
  }
  let monthly: { label: string; total: number }[] = [];
  if (byMonth.size > 0) {
    const keys = [...byMonth.keys()].sort();
    const [minY, minM] = keys[0].split("-").map(Number);
    const [maxY, maxM] = keys[keys.length - 1].split("-").map(Number);
    for (let y = minY, m = minM; y < maxY || (y === maxY && m <= maxM); ) {
      const k = `${y}-${String(m).padStart(2, "0")}`;
      monthly.push({ label: `${MONTH[m - 1]} ${String(y).slice(2)}`, total: Math.round(byMonth.get(k) ?? 0) });
      if (++m > 12) { m = 1; y++; }
    }
    if (monthly.length > 24) monthly = monthly.slice(-24);
  }

  const cardTotal = new Map<number, number>();
  for (const t of spends) cardTotal.set(t.cardId, (cardTotal.get(t.cardId) ?? 0) + t.amount);
  const perCard = cards.map((c) => ({ id: c.id, name: c.name, bank: c.bank, last4: c.last4, color: c.color, limitAmt: c.limitAmt, total: cardTotal.get(c.id) ?? 0 }));

  const merch = new Map<string, { total: number; count: number }>();
  for (const t of spends) {
    const key = t.merchant.trim();
    const g = merch.get(key) ?? { total: 0, count: 0 };
    g.total += t.amount;
    g.count += 1;
    merch.set(key, g);
  }
  const topMerchants = [...merch.entries()]
    .map(([merchant, g]) => ({ merchant, ...g }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);

  const monthsActive = byMonth.size;
  const recent = txns.slice(0, 60).map((t) => ({
    id: t.id,
    date: t.date,
    merchant: t.merchant,
    amount: t.amount,
    type: t.type,
    cardName: cardName.get(t.cardId) ?? "—",
  }));

  return {
    cards: perCard,
    allTime,
    monthsActive,
    avgMonthly: monthsActive ? allTime / monthsActive : 0,
    txnCount: txns.length,
    monthly,
    topMerchants,
    recent,
    hasData: txns.length > 0,
  };
}
