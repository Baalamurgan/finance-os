import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// RUN-ONCE history import for FEB/APR/MAY/JUN 2026 (MAR comes from seed.ts).
// Summary-level: real INCOME lines + the real monthly EXPENSE total (one line) so
// Trends/balance are accurate, plus the real settlement transfers (as settled records)
// and the KA hub. Idempotent — skips a month whose period already exists.
// Note: expense is a single imported line (not itemised); enter granular lines in-app if needed.
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

type Inc = { source: string; amount: number; owner: string | null };
type Tx = { from: string; to: string; amount: number };
type M = { y: number; m: number; label: string; incomes: Inc[]; expenseTotal: number; hub: string; transfers: Tx[] };

const HISTORY: M[] = [
  {
    y: 2026, m: 2, label: "FEB 2026", expenseTotal: 215146, hub: "KA",
    incomes: [
      { source: "VL Salary", amount: 70000, owner: "VL" }, { source: "Harish Salary", amount: 79000, owner: "H" },
      { source: "Bala Salary", amount: 79000, owner: "B" }, { source: "KA Salary", amount: 60000, owner: "KA" },
      { source: "Next Home Rent", amount: 21000, owner: null }, { source: "Urbanrise Rent", amount: 20000, owner: null },
      { source: "G704 Rent", amount: 16000, owner: null }, { source: "KA Extra/Ration", amount: 13000, owner: "KA" },
    ],
    transfers: [{ from: "Bala", to: "KA", amount: 43478 }, { from: "KA", to: "Harish", amount: 28453 }, { from: "KA", to: "VL", amount: 3000 }],
  },
  {
    y: 2026, m: 4, label: "APR 2026", expenseTotal: 344558, hub: "KA",
    incomes: [
      { source: "VL Salary", amount: 70000, owner: "VL" }, { source: "Harish Salary", amount: 79000, owner: "H" },
      { source: "Bala Salary", amount: 79000, owner: "B" }, { source: "KA Salary", amount: 60000, owner: "KA" },
      { source: "Kanniammal Rent", amount: 21000, owner: null }, { source: "G1410 Rent", amount: 20000, owner: null },
      { source: "G704 Rent", amount: 16000, owner: null },
    ],
    transfers: [{ from: "Bala", to: "KA", amount: 61190 }, { from: "KA", to: "Harish", amount: 19604 }, { from: "KA", to: "VL", amount: 19826 }],
  },
  {
    y: 2026, m: 5, label: "MAY 2026", expenseTotal: 386391, hub: "KA",
    incomes: [
      { source: "VL Loan", amount: 117000, owner: "VL" }, { source: "Harish Salary", amount: 79000, owner: "H" },
      { source: "Bala Salary", amount: 79000, owner: "B" }, { source: "KA Salary", amount: 60000, owner: "KA" },
      { source: "Kanniammal Rent", amount: 21000, owner: null }, { source: "G1410 Rent", amount: 20000, owner: null },
      { source: "G704 Rent", amount: 16000, owner: null }, { source: "Piggy (Apr26)", amount: 3284, owner: null },
    ],
    transfers: [{ from: "Bala", to: "KA", amount: 46217 }, { from: "KA", to: "Harish", amount: 16171 }, { from: "KA", to: "VL", amount: 10265 }],
  },
  {
    y: 2026, m: 6, label: "JUN 2026", expenseTotal: 360938, hub: "KA",
    incomes: [
      { source: "Paiyur Paddy", amount: 7580, owner: null }, { source: "VL Salary", amount: 70000, owner: "VL" },
      { source: "Harish Salary", amount: 79000, owner: "H" }, { source: "Bala Salary", amount: 79000, owner: "B" },
      { source: "KA Salary", amount: 60000, owner: "KA" }, { source: "Kanniammal Rent", amount: 22000, owner: null },
      { source: "G1410 Rent", amount: 21000, owner: null }, { source: "G704 Rent", amount: 16000, owner: null },
      { source: "Chimney & others", amount: 250, owner: null },
    ],
    // JUN: KA→Harish was -18897 in the sheet → Harish pays KA instead
    transfers: [{ from: "Bala", to: "KA", amount: 52169.5 }, { from: "Harish", to: "KA", amount: 18897 }, { from: "KA", to: "VL", amount: 29620 }],
  },
];

const NAME2CODE: Record<string, string> = { Bala: "B", KA: "KA", Harish: "H", VL: "VL" };

async function main() {
  const hh = await prisma.household.findFirst();
  if (!hh) throw new Error("No household — run db:seed first.");
  const members = Object.fromEntries((await prisma.member.findMany({ where: { householdId: hh.id } })).map((x) => [x.code, x.id]));
  const anyCat = (await prisma.category.findFirst({ where: { householdId: hh.id, name: "Loan" } })) ??
    (await prisma.category.findFirst({ where: { householdId: hh.id } }));
  if (!anyCat) throw new Error("No category to attach imported expense to.");

  for (const mo of HISTORY) {
    const exists = await prisma.period.findUnique({ where: { householdId_year_month: { householdId: hh.id, year: mo.y, month: mo.m } } });
    if (exists) { console.log(`skip ${mo.label} (exists)`); continue; }

    const incomeTotal = mo.incomes.reduce((s, i) => s + i.amount, 0);
    const period = await prisma.period.create({
      data: { householdId: hh.id, year: mo.y, month: mo.m, label: mo.label, status: "closed", closedAt: new Date(), treasurerMemberId: members[mo.hub] ?? null },
    });
    for (const i of mo.incomes)
      await prisma.incomeEntry.create({ data: { periodId: period.id, source: i.source, amount: i.amount, ownerId: i.owner ? members[i.owner] : null } });
    await prisma.expenseEntry.create({
      data: { periodId: period.id, label: "Imported monthly total", amount: mo.expenseTotal, categoryId: anyCat.id, necessary: true },
    });
    for (const t of mo.transfers)
      await prisma.settlementRecord.create({
        data: { householdId: hh.id, periodId: period.id, fromMemberId: members[NAME2CODE[t.from]], toMemberId: members[NAME2CODE[t.to]], amount: t.amount, note: "imported" },
      });
    console.log(`imported ${mo.label}: income ${incomeTotal}, expense ${mo.expenseTotal}, balance ${incomeTotal - mo.expenseTotal}, ${mo.transfers.length} settlements`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
