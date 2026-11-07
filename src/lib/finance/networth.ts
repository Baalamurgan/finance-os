import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { computeBalance } from "@/lib/finance/balance";
import { BALANCE_ACCOUNT_TYPES } from "@/lib/finance/types";
import { getCardDues } from "@/lib/personal/cash";
import { istDateParts } from "@/lib/time";

// ── Personal net worth ────────────────────────────────────────────────────────────────────────────────
// PERSONAL ONLY — every query is scoped to one member and only the personal app reads it (never the family
// views). Net worth = bank & cash balances + holdings' current value + money lent out
//                    − your share of unpaid card bills − money borrowed − loans.
// A holding keeps a dated history (NetWorthEntry): opening / contribution / withdrawal move "Invested"; a
// "value" entry records a hand-set current value. A contribution also lifts the current value by the same
// amount, so an untouched holding's value = what went in.

const r2 = (n: number) => Math.round(n * 100) / 100;

export type HoldingEntry = { id: number; date: string; kind: string; amount: number; note: string | null; auto: boolean };
export type Holding = {
  id: number; category: "asset" | "liability"; type: string; name: string; institution: string | null; notes: string | null; quantity: number | null;
  value: number; invested: number; gain: number; gainPct: number | null; valueAsOf: string | null;
  startDate: string | null; tenureMonths: number | null; interestRate: number | null;
  maturity: { date: string; value: number; daysLeft: number } | null;
  linked: string[]; // Setup items that add to it every month ("Groww MF · ₹30,500 / month")
  entries: HoldingEntry[]; // newest first
};

// FD / RD maturity: Indian bank FDs compound quarterly. A = P·(1 + r/400)^(4·years).
export function fdMaturity(principal: number, ratePct: number, startISO: string, tenureMonths: number, now = new Date()) {
  const start = new Date(startISO);
  const date = new Date(start.getFullYear(), start.getMonth() + tenureMonths, start.getDate());
  const value = r2(principal * Math.pow(1 + ratePct / 400, 4 * (tenureMonths / 12)));
  const daysLeft = Math.ceil((date.getTime() - now.getTime()) / 86400000);
  return { date: date.toISOString(), value, daysLeft };
}

// Σ money in: opening + contributions − withdrawals ("value" entries don't change what you put in).
export function investedOf(entries: { kind: string; amount: number }[]): number {
  return r2(entries.reduce((t, e) => t + (e.kind === "opening" || e.kind === "contribution" ? e.amount : e.kind === "withdrawal" ? -e.amount : 0), 0));
}

// Add money to a holding (a Money Plan tick, a planned spend paid, or by hand) — history entry + value up.
export async function addContribution(
  tx: Prisma.TransactionClient,
  a: { memberId: number; itemId: number; amount: number; date: Date; note: string | null; planStepId?: number | null; spendId?: number | null },
) {
  const item = await tx.netWorthItem.findFirst({ where: { id: a.itemId, memberId: a.memberId, category: "asset" }, select: { id: true } });
  if (!item || a.amount <= 0) return;
  await tx.netWorthEntry.create({ data: { memberId: a.memberId, itemId: a.itemId, date: a.date, kind: "contribution", amount: r2(a.amount), note: a.note, planStepId: a.planStepId ?? null, spendId: a.spendId ?? null } });
  await tx.netWorthItem.update({ where: { id: a.itemId }, data: { value: { increment: r2(a.amount) } } });
}

// Undo the contribution(s) a tick / planned-spend payment made (untick, delete, unpay): entry gone, value down.
export async function removeContributions(tx: Prisma.TransactionClient, memberId: number, by: { planStepId?: number; spendId?: number }) {
  const where = { memberId, kind: "contribution", ...(by.planStepId != null ? { planStepId: by.planStepId } : { spendId: by.spendId }) };
  if (by.planStepId == null && by.spendId == null) return;
  const rows = await tx.netWorthEntry.findMany({ where, select: { id: true, itemId: true, amount: true } });
  for (const e of rows) {
    await tx.netWorthItem.update({ where: { id: e.itemId }, data: { value: { decrement: e.amount } } });
    await tx.netWorthEntry.delete({ where: { id: e.id } });
  }
}

export type NetWorthOverview = {
  netWorth: number; assets: number; liabilities: number;
  accounts: { id: number; name: string; color: string; type: string; balance: number }[]; accountsTotal: number;
  holdings: Holding[]; holdingsTotal: number; investedTotal: number;
  lent: number; borrowed: number; cardDues: number; loans: Holding[]; loansTotal: number;
  trend: { year: number; month: number; netWorth: number }[]; lastMonth: number | null;
};

export async function getNetWorthOverview(memberId: number, now = new Date()): Promise<NetWorthOverview> {
  const [accts, txns, items, loanRows, dues, templates, planItems] = await Promise.all([
    prisma.financeAccount.findMany({ where: { memberId, active: true, type: { in: [...BALANCE_ACCOUNT_TYPES] } }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }], select: { id: true, name: true, color: true, type: true, openingBalance: true } }),
    prisma.accountTransaction.findMany({ where: { memberId }, select: { accountId: true, date: true, amount: true, type: true } }),
    prisma.netWorthItem.findMany({ where: { memberId }, include: { entries: { orderBy: [{ date: "desc" }, { id: "desc" }] } }, orderBy: [{ value: "desc" }] }),
    prisma.personalLoan.findMany({ where: { memberId, status: "open" }, select: { direction: true, outstanding: true, cardAccountId: true } }),
    getCardDues(memberId),
    prisma.personalTemplate.findMany({ where: { memberId, active: true, holdingId: { not: null } }, select: { holdingId: true, label: true, amount: true } }),
    prisma.personalPlanItem.findMany({ where: { memberId, active: true, holdingId: { not: null } }, select: { holdingId: true, label: true, amount: true } }),
  ]);
  const byAcct = new Map<number, { date: Date; amount: number; type: string }[]>();
  for (const t of txns) (byAcct.get(t.accountId) ?? byAcct.set(t.accountId, []).get(t.accountId)!).push(t);
  const accounts = accts.map((a) => ({ id: a.id, name: a.name, color: a.color, type: a.type, balance: computeBalance(a.openingBalance, byAcct.get(a.id) ?? []) }));
  const accountsTotal = r2(accounts.reduce((t, a) => t + Math.max(0, a.balance), 0));

  const linkedOf = (id: number) => [...templates, ...planItems].filter((x) => x.holdingId === id).map((x) => `${x.label} · ₹${Math.round(x.amount).toLocaleString("en-IN")} / month`);
  const toHolding = (i: (typeof items)[number]): Holding => {
    const invested = investedOf(i.entries);
    const base = invested > 0 ? invested : i.value;
    const gain = r2(i.value - base);
    const maturity = i.type === "fd" || i.type === "rd"
      ? i.startDate && i.tenureMonths && i.interestRate != null ? fdMaturity(invested > 0 ? invested : i.value, i.interestRate, i.startDate.toISOString(), i.tenureMonths, now) : null
      : null;
    return {
      id: i.id, category: i.category as "asset" | "liability", type: i.type, name: i.name, institution: i.institution, notes: i.notes, quantity: i.quantity,
      value: r2(i.value), invested, gain, gainPct: base > 0 ? r2((gain / base) * 100) : null, valueAsOf: i.valueAsOf?.toISOString() ?? null,
      startDate: i.startDate?.toISOString() ?? null, tenureMonths: i.tenureMonths, interestRate: i.interestRate, maturity,
      linked: linkedOf(i.id),
      entries: i.entries.map((e) => ({ id: e.id, date: e.date.toISOString(), kind: e.kind, amount: e.amount, note: e.note, auto: e.planStepId != null || e.spendId != null })),
    };
  };
  const holdings = items.filter((i) => i.category === "asset").map(toHolding);
  const loans = items.filter((i) => i.category === "liability").map(toHolding);
  const holdingsTotal = r2(holdings.reduce((t, h) => t + h.value, 0));
  const investedTotal = r2(holdings.reduce((t, h) => t + h.invested, 0));
  const loansTotal = r2(loans.reduce((t, h) => t + h.value, 0));
  const lent = r2(loanRows.filter((l) => l.direction === "lent").reduce((t, l) => t + l.outstanding, 0));
  // Everything you owe someone — cash they lent you AND a spend on their card you still have to repay them.
  const borrowed = r2(loanRows.filter((l) => l.direction === "borrowed").reduce((t, l) => t + l.outstanding, 0));
  // Your share of unpaid card bills (the family share is paid back by the family, so it isn't yours to owe).
  const cardDues = r2(dues.reduce((t, d) => t + d.unpaidTotal, 0));

  const assets = r2(accountsTotal + holdingsTotal + lent);
  const liabilities = r2(cardDues + borrowed + loansTotal);
  const netWorth = r2(assets - liabilities);

  // Trend: this month's snapshot is refreshed on every visit; past months keep their last value.
  const { year, month } = istDateParts(now);
  await prisma.netWorthSnapshot.upsert({
    where: { memberId_year_month: { memberId, year, month } },
    update: { netWorth, assets, liabilities },
    create: { memberId, year, month, netWorth, assets, liabilities },
  });
  const snaps = await prisma.netWorthSnapshot.findMany({ where: { memberId }, orderBy: [{ year: "desc" }, { month: "desc" }], take: 12, select: { year: true, month: true, netWorth: true } });
  const trend = snaps.reverse();
  const prev = trend.length >= 2 ? trend[trend.length - 2].netWorth : null;

  return { netWorth, assets, liabilities, accounts, accountsTotal, holdings, holdingsTotal, investedTotal, lent, borrowed, cardDues, loans, loansTotal, trend, lastMonth: prev };
}

// The holding a Setup investment should feed, from its form: an existing holding of the member's ("<id>"), a new
// one created right now ("new" + newHoldingName/newHoldingType — empty history, value ₹0 until you add what you
// have), or none. Personal-only, member-scoped.
export async function resolveHoldingFromForm(memberId: number, formData: FormData, fallbackName: string): Promise<number | null> {
  const raw = String(formData.get("holdingId") ?? "").trim();
  if (!raw) return null;
  if (raw === "new") {
    const { ASSET_TYPES } = await import("@/lib/finance/types");
    const typeRaw = String(formData.get("newHoldingType") ?? "");
    const type = ASSET_TYPES.some((t) => t.key === typeRaw) ? typeRaw : "other_asset";
    const name = (String(formData.get("newHoldingName") ?? "").trim() || fallbackName || "Investment").slice(0, 120);
    // re-use a holding of the same name rather than making a duplicate
    const same = await prisma.netWorthItem.findFirst({ where: { memberId, category: "asset", name }, select: { id: true } });
    if (same) return same.id;
    return (await prisma.netWorthItem.create({ data: { memberId, category: "asset", type, name, value: 0 } })).id;
  }
  const id = Number(raw);
  if (!id) return null;
  return (await prisma.netWorthItem.findFirst({ where: { id, memberId, category: "asset" }, select: { id: true } }))?.id ?? null;
}
