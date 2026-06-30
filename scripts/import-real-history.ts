// AUTHORITATIVE re-import of the family's real Feb–Jun 2026 sheets, exactly.
// Wipes all period financial data + piggy + settlements, merges VL→Lakshmi(VL),
// inserts each month's exact income + expense lines (with member tags), sets
// tracked budgets + fully-spent spends, regenerates an open JULY from June's
// recurring lines, Piggy = 0. Aborts if any month's totals don't match the sheet.
//   npm run import:real
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

type Inc = [source: string, amount: number, owner: string | null];
type Exp = [label: string, amount: number, cat: string, member: string | null];

// tracked category allocations (same every month) — also used for budgets + spends
const BUDGETS: Record<string, number> = {
  Provision: 5000, "Veg & Fruits": 5000, "Non-Veg": 3000, Petrol: 12000,
  EB: 2000, "LPG Gas": 1000, WiFi: 1269, "Mobile Recharge": 1541,
};

const MONTHS: Record<string, { y: number; m: number; income: Inc[]; expense: Exp[]; checkInc: number; checkExp: number }> = {
  FEB: {
    y: 2026, m: 2, checkInc: 358000, checkExp: 215146,
    income: [
      ["VL Salary", 70000, "L"], ["Harish salary", 79000, "H"], ["Bala salary", 79000, "B"],
      ["KA Salary", 60000, "KA"], ["Next home rent", 21000, null], ["Urbanrise-rent", 20000, null],
      ["G704 - RENT", 16000, null], ["KA EXTRA, RATION", 13000, "KA"],
    ],
    expense: [
      ["BOB loan", 61750, "Loan", "H"], ["JL1", 6296, "Loan", null], ["JL2", 5241, "Loan", null], ["JL3", 3139, "Loan", null],
      ["VL-JL-TRUSTPURAM INTEREST", 6100, "Interest", "H"], ["GILLNAGAR-HARISH-JL INT", 2665, "Interest", "H"], ["KA-3L-INTEREST", 4500, "Interest", "KA"],
      ["HARISH CHIT", 8500, "Chit", "H"],
      ["EB AMT", 2000, "EB", "B"], ["GOD", 1001, "God", null], ["COW MILK", 0, "Household", null], ["car cleaning chgs", 500, "Household", null],
      ["MAINTANANCE-BFC", 1000, "Household", null], ["WIFI", 1269, "WiFi", "B"], ["GAS", 1000, "LPG Gas", "B"], ["CAR PETROL", 12000, "Petrol", "B"],
      ["MILK", 625, "Household", null], ["VL VAN", 3000, "Transport", "L"], ["SERVANT", 6000, "Household", null], ["TENNIS", 0, "Household", "B"], ["mobile recharges", 1541, "Mobile Recharge", "B"],
      ["HARISH EXP", 10000, "Personal/Misc", "H"], ["BALA EXP", 0, "Personal/Misc", "B"], ["VL EXP", 5000, "Personal/Misc", "L"],
      ["PROVISION EXP", 5000, "Provision", null], ["VEG & FRUITS EXP", 5000, "Veg & Fruits", null], ["NON VEG EXP", 3000, "Non-Veg", null],
      ["misc exp - bala", 305, "Personal/Misc", "B"], ["misc exp - harish", 1115, "Personal/Misc", "H"], ["misc exp - ka", 16374, "Personal/Misc", "KA"],
      ["BALA MRI SCAN", 5250, "Personal/Misc", "B"], ["SPENCER ZUDIO SHOPPING", 4201, "Personal/Misc", "B"], ["DIO BIKE SERVICE", 4410, "Household", "B"], ["AMBUR BIRIYANI", 1364, "Personal/Misc", "B"],
      ["LOAN AMT FOR THATHA GOLD - HARISH", 20000, "Loan", "H"], ["GEETHA CHIT AMT - THATHA GOLD - HARISH", 6000, "Chit", "H"],
    ],
  },
  MAR: {
    y: 2026, m: 3, checkInc: 345102, checkExp: 174451,
    income: [
      ["VL Salary", 70000, "L"], ["Harish salary", 79000, "H"], ["Bala salary", 79000, "B"], ["KA Salary", 60000, "KA"],
      ["Next home rent", 21000, null], ["Urbanrise-rent", 20000, null], ["G704 - RENT", 16000, null], ["(EXTRA)", 102, null],
    ],
    expense: [
      ["BOB loan", 61750, "Loan", "H"], ["JL1", 6296, "Loan", null], ["JL2", 5241, "Loan", null], ["JL3", 3139, "Loan", null],
      ["VL-JL-TRUSTPURAM INTEREST", 6100, "Interest", "H"], ["GILLNAGAR-HARISH-JL INT", 2665, "Interest", "H"], ["KA-3L-INTEREST", 4500, "Interest", "KA"],
      ["HARISH CHIT", 8500, "Chit", "H"],
      ["EB AMT", 2000, "EB", "B"], ["GOD", 1001, "God", null], ["COW MILK", 0, "Household", null], ["car cleaning chgs", 500, "Household", null],
      ["MAINTANANCE-BFC", 1000, "Household", null], ["WIFI", 1269, "WiFi", "B"], ["GAS", 1000, "LPG Gas", "B"], ["CAR PETROL", 12000, "Petrol", "B"],
      ["MILK", 625, "Household", null], ["VL VAN", 3000, "Transport", "L"], ["SERVANT", 6000, "Household", null], ["TENNIS", 0, "Household", "B"], ["mobile recharges", 1541, "Mobile Recharge", "B"],
      ["HARISH EXP", 10000, "Personal/Misc", "H"], ["BALA EXP", 0, "Personal/Misc", "B"], ["VL EXP", 5000, "Personal/Misc", "L"],
      ["PROVISION EXP", 5000, "Provision", null], ["VEG & FRUITS EXP", 5000, "Veg & Fruits", null], ["NON VEG EXP", 3000, "Non-Veg", null],
      ["misc exp - bala", 4232, "Personal/Misc", "B"], ["misc exp - harish", 0, "Personal/Misc", "H"], ["misc exp - ka", 9092, "Personal/Misc", "KA"],
      ["Harish Loan Repay", 0, "Loan", "H"], ["misc exp - Lakshmi", 0, "Personal/Misc", "L"],
      ["Vana Marriage Gift - Gold (5K)", 5000, "Giving/Religious", "B"],
    ],
  },
  APR: {
    y: 2026, m: 4, checkInc: 345000, checkExp: 344558,
    income: [
      ["VL Salary", 70000, "L"], ["Harish salary", 79000, "H"], ["Bala salary", 79000, "B"], ["KA Salary", 60000, "KA"],
      ["Kanniammal Rent", 21000, null], ["G1410 - Rent", 20000, null], ["G704 - Rent", 16000, null],
    ],
    expense: [
      ["BOB loan", 61750, "Loan", "H"], ["JL1", 7329, "Loan", null], ["JL2", 5680, "Loan", null], ["JL3", 3137, "Loan", null],
      ["VL-JL-TRUSTPURAM INTEREST", 6100, "Interest", "H"], ["GILLNAGAR-HARISH-JL INT", 2665, "Interest", "H"], ["to JL Prinicipal", 160000, "Loan", null], ["KA-3L-INTEREST", 4500, "Interest", "KA"],
      ["HARISH CHIT", 8500, "Chit", "H"],
      ["EB AMT", 2000, "EB", "B"], ["GOD", 1001, "God", null], ["COW MILK", 0, "Household", null], ["car cleaning chgs", 500, "Household", null],
      ["MAINTANANCE-BFC", 1000, "Household", null], ["WIFI", 1269, "WiFi", "B"], ["GAS", 1000, "LPG Gas", "B"], ["CAR PETROL", 12000, "Petrol", "B"],
      ["MILK", 740, "Household", null], ["VL VAN", 3000, "Transport", "L"], ["SERVANT", 6000, "Household", null], ["TENNIS", 0, "Household", "B"], ["mobile recharges", 1541, "Mobile Recharge", "B"],
      ["HARISH EXP", 10000, "Personal/Misc", "H"], ["BALA EXP", 0, "Personal/Misc", "B"], ["VL EXP", 5000, "Personal/Misc", "L"],
      ["PROVISION EXP", 5000, "Provision", "H"], ["VEG & FRUITS EXP", 5000, "Veg & Fruits", null], ["NON VEG EXP", 3000, "Non-Veg", null],
      ["misc exp - bala", 0, "Personal/Misc", "B"], ["misc exp - harish", 796, "Personal/Misc", "H"], ["misc exp - ka", 4501, "Personal/Misc", "KA"], ["misc exp - Lakshmi", 3326, "Personal/Misc", "L"],
      ["Go dhanam", 1500, "Giving/Religious", null], ["to vl - arni", 1500, "Personal/Misc", "L"], ["saravana stores - vl", 1702, "Personal/Misc", "L"], ["property tax II / 25-26", 1185, "Household", null],
      ["kotturpuram athai exp", 2500, "Personal/Misc", "H"], ["Wallnut rukkamma", 285, "Household", "H"], ["amazon prime", 1399, "Personal/Misc", "H"], ["thatha groceries", 0, "Personal/Misc", "H"],
      ["lakshmi, geetha makeup items", 1438, "Personal/Misc", "H"], ["flower pot", 300, "Household", "H"], ["Induction stove repair", 550, "Household", "H"], ["Egg boiler", 1699, "Household", "H"], ["G704-maintanance chgs", 4165, "Household", null],
    ],
  },
  MAY: {
    y: 2026, m: 5, checkInc: 395284, checkExp: 386391,
    income: [
      ["VL Loan", 117000, "L"], ["Harish salary", 79000, "H"], ["Bala salary", 79000, "B"], ["KA Salary", 60000, "KA"],
      ["Kanniammal Rent", 21000, null], ["G1410 - Rent", 20000, null], ["G704 - Rent", 16000, null], ["Piggy Amount - Apr26", 3284, null],
    ],
    expense: [
      ["BOB loan", 61750, "Loan", "H"], ["JL1", 7463, "Loan", null], ["JL2", 5207, "Loan", null], ["JL3", 1964, "Loan", null],
      ["VL-JL-TRUSTPURAM INTEREST", 6100, "Interest", "H"], ["GILLNAGAR-HARISH-JL INT", 2665, "Interest", "H"], ["to JL principal part", 200000, "Loan", null], ["KA-3L-INTEREST", 4500, "Interest", "KA"],
      ["HARISH CHIT", 8500, "Chit", "H"],
      ["EB AMT", 2000, "EB", "B"], ["GOD", 1001, "God", null], ["HARISH - family insurance amt", 2300, "Personal/Misc", "H"], ["car cleaning chgs", 500, "Household", null],
      ["MAINTANANCE-BFC", 1000, "Household", null], ["WIFI", 1269, "WiFi", "B"], ["GAS", 1000, "LPG Gas", "B"], ["CAR PETROL", 12000, "Petrol", "B"],
      ["MILK", 763, "Household", null], ["VL VAN", 0, "Transport", "L"], ["SERVANT", 5200, "Household", null], ["TENNIS", 0, "Household", "B"], ["mobile recharges", 1541, "Mobile Recharge", "B"],
      ["HARISH EXP", 10000, "Personal/Misc", "H"], ["BALA EXP", 0, "Personal/Misc", "B"], ["VL EXP", 0, "Personal/Misc", "L"],
      ["PROVISION EXP", 5000, "Provision", null], ["VEG & FRUITS EXP", 5000, "Veg & Fruits", null], ["NON VEG EXP", 3000, "Non-Veg", null],
      ["misc exp - bala", 0, "Personal/Misc", "B"], ["misc exp - harish", 202, "Personal/Misc", "H"], ["misc exp - ka", 3555, "Personal/Misc", "KA"], ["misc exp - Lakshmi", 1765, "Personal/Misc", "L"],
      ["RO Repair chgs", 2770, "Household", null], ["kanniammal lift repair chgs", 1880, "Household", null], ["R15 bike repair chgs", 12842, "Household", "B"], ["KA birthday expenses", 1500, "Personal/Misc", "B"], ["Tamil Matrimony - register fees", 12154, "Personal/Misc", "H"],
    ],
  },
  JUN: {
    y: 2026, m: 6, checkInc: 354830, checkExp: 360938,
    income: [
      ["paiyur paddy (2580+5000)", 7580, null], ["VL Salary", 70000, "L"], ["Harish salary", 79000, "H"], ["Bala salary", 79000, "B"], ["KA Salary", 60000, "KA"],
      ["Kanniammal Rent", 22000, null], ["G1410 - Rent", 21000, null], ["G704 - Rent", 16000, null], ["chimny & others", 250, null],
    ],
    expense: [
      ["BOB loan", 61750, "Loan", "H"], ["JL1", 7463, "Loan", null], ["JL2", 5207, "Loan", null], ["JL3", 1441, "Loan", null],
      ["VL-JL-TRUSTPURAM INTEREST", 6100, "Interest", "H"], ["GILLNAGAR-HARISH-JL INT", 2665, "Interest", "H"], ["JL3 account closed", 67784, "Loan", null], ["KA-3L-INTEREST", 4500, "Interest", "KA"],
      ["To KA - outside loan return (3L)", 100000, "Loan", "KA"],
      ["HARISH CHIT", 8750, "Chit", "H"],
      ["EB AMT", 2000, "EB", "B"], ["GOD", 1001, "God", null], ["HARISH - family insurance amt", 2300, "Personal/Misc", "H"], ["car cleaning chgs", 500, "Household", null],
      ["MAINTANANCE-BFC", 1000, "Household", null], ["WIFI", 1269, "WiFi", "B"], ["GAS", 1000, "LPG Gas", "B"], ["CAR PETROL", 12000, "Petrol", "B"],
      ["MILK", 763, "Household", null], ["VL VAN", 3000, "Transport", "L"], ["SERVANT", 0, "Household", null], ["You tube charges", 299, "Personal/Misc", "B"], ["mobile recharges", 1541, "Mobile Recharge", "B"],
      ["HARISH EXP", 10000, "Personal/Misc", "H"], ["BALA EXP", 0, "Personal/Misc", "B"], ["VL EXP", 5000, "Personal/Misc", "L"],
      ["PROVISION EXP", 5000, "Provision", "H"], ["VEG & FRUITS EXP", 5000, "Veg & Fruits", "H"], ["NON VEG EXP", 3000, "Non-Veg", null],
      ["Jewel loan renewal charges", 2000, "Interest", "L"], ["Jewel loan renewal charges", 800, "Interest", null], ["misc exp - bala", 7562, "Personal/Misc", "B"], ["misc exp - harish", 82, "Personal/Misc", "H"], ["misc exp - ka", 3171, "Personal/Misc", "KA"],
      ["provision exc exp (veg bal + nv bal)", 1256, "Provision", "H"], ["misc exp - Lakshmi", 870, "Personal/Misc", "L"], ["chimney instalment 1", 2780, "Household", "H"], ["VL Loan refund (ef apr26 income)", 17000, "Loan", null],
      ["G704 maintanance chgs", 2083, "Household", null], ["Thulasi son marriage moi", 2001, "Giving/Religious", null], ["Annapurni husband expense", 1000, "Personal/Misc", "L"],
    ],
  },
};

// JULY = going-forward open month: June's recurring lines only (no one-offs)
const JULY = {
  y: 2026, m: 7,
  income: [
    ["VL Salary", 70000, "L"], ["Harish salary", 79000, "H"], ["Bala salary", 79000, "B"], ["KA Salary", 60000, "KA"],
    ["Kanniammal Rent", 22000, null], ["G1410 - Rent", 21000, null], ["G704 - Rent", 16000, null],
  ] as Inc[],
  expense: [
    ["BOB loan", 61750, "Loan", "H"], ["JL1", 7463, "Loan", null], ["JL2", 5207, "Loan", null], ["JL3", 1441, "Loan", null],
    ["VL-JL-TRUSTPURAM INTEREST", 6100, "Interest", "H"], ["GILLNAGAR-HARISH-JL INT", 2665, "Interest", "H"], ["KA-3L-INTEREST", 4500, "Interest", "KA"],
    ["HARISH CHIT", 8750, "Chit", "H"],
    ["EB AMT", 2000, "EB", "B"], ["GOD", 1001, "God", null], ["HARISH - family insurance amt", 2300, "Personal/Misc", "H"], ["car cleaning chgs", 500, "Household", null],
    ["MAINTANANCE-BFC", 1000, "Household", null], ["WIFI", 1269, "WiFi", "B"], ["GAS", 1000, "LPG Gas", "B"], ["CAR PETROL", 12000, "Petrol", "B"],
    ["MILK", 763, "Household", null], ["VL VAN", 3000, "Transport", "L"], ["You tube charges", 299, "Personal/Misc", "B"], ["mobile recharges", 1541, "Mobile Recharge", "B"],
    ["HARISH EXP", 10000, "Personal/Misc", "H"], ["BALA EXP", 0, "Personal/Misc", "B"], ["VL EXP", 5000, "Personal/Misc", "L"],
    ["PROVISION EXP", 5000, "Provision", null], ["VEG & FRUITS EXP", 5000, "Veg & Fruits", null], ["NON VEG EXP", 3000, "Non-Veg", null],
  ] as Exp[],
};

const monthLabel = (y: number, m: number) =>
  `${["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"][m - 1]} ${y}`;

async function main() {
  const hh = await prisma.household.findFirst();
  if (!hh) throw new Error("no household");
  const householdId = hh.id;

  // ---- member merge: VL → Lakshmi (VL), code L ----
  const vl = await prisma.member.findFirst({ where: { householdId, code: "VL" } });
  const lak = await prisma.member.findFirst({ where: { householdId, code: "L" } });
  if (vl && lak) {
    await prisma.loan.updateMany({ where: { memberId: vl.id }, data: { memberId: lak.id } });
    await prisma.category.updateMany({ where: { responsibleMemberId: vl.id }, data: { responsibleMemberId: lak.id } });
  }

  // ---- wipe all period financial data + piggy + settlements ----
  await prisma.$transaction([
    prisma.piggyEntry.deleteMany({ where: { householdId } }),
    prisma.settlementRecord.deleteMany({ where: { householdId } }),
    prisma.spend.deleteMany({}),
    prisma.budget.deleteMany({}),
    prisma.expenseEntry.deleteMany({}),
    prisma.incomeEntry.deleteMany({}),
  ]);
  if (vl && lak) {
    await prisma.member.delete({ where: { id: vl.id } });
    await prisma.member.update({ where: { id: lak.id }, data: { name: "Lakshmi (VL)", code: "L" } });
  }

  // ---- category config: EB=2000, sinking flags + cycles ----
  const sinkingCfg: Record<string, { budget: number; cycle: number }> = {
    EB: { budget: 2000, cycle: 2 }, WiFi: { budget: 1269, cycle: 3 },
    "Mobile Recharge": { budget: 1541, cycle: 12 }, "LPG Gas": { budget: 1000, cycle: 2 },
  };
  for (const [name, cfg] of Object.entries(sinkingCfg)) {
    await prisma.category.updateMany({
      where: { householdId, name },
      data: { sinking: true, monthlyBudget: cfg.budget, cycleMonths: cfg.cycle, tracked: true },
    });
  }

  // resolve members + categories
  const members = await prisma.member.findMany({ where: { householdId } });
  const memId = (code: string | null) => (code ? members.find((m) => m.code === code)?.id ?? null : null);
  const cats = await prisma.category.findMany({ where: { householdId } });
  const catId = (name: string) => {
    const c = cats.find((x) => x.name === name);
    if (!c) throw new Error(`category not found: ${name}`);
    return c.id;
  };

  async function writeMonth(
    y: number, m: number, income: Inc[], expense: Exp[], status: string, withSpends: boolean,
  ) {
    const label = monthLabel(y, m);
    const period = await prisma.period.upsert({
      where: { householdId_year_month: { householdId, year: y, month: m } },
      create: { householdId, year: y, month: m, label, status, carryForward: 0, movedToPiggy: 0 },
      update: { label, status, carryForward: 0, movedToPiggy: 0 },
    });
    for (const [source, amount, owner] of income) {
      await prisma.incomeEntry.create({ data: { periodId: period.id, source, amount, ownerId: memId(owner) } });
    }
    for (const [labelE, amount, cat, member] of expense) {
      await prisma.expenseEntry.create({
        data: { periodId: period.id, label: labelE, amount, categoryId: catId(cat), memberId: memId(member), necessary: true },
      });
    }
    // budgets for tracked categories + fully-spent spends
    for (const [name, planned] of Object.entries(BUDGETS)) {
      await prisma.budget.create({ data: { periodId: period.id, categoryId: catId(name), planned } });
      if (withSpends) {
        await prisma.spend.create({ data: { periodId: period.id, categoryId: catId(name), amount: planned, label: `${name} (spent)`, memberId: null } });
      }
    }
    const incSum = income.reduce((s, r) => s + r[1], 0);
    const expSum = expense.reduce((s, r) => s + r[1], 0);
    return { label, incSum, expSum, periodId: period.id };
  }

  // ---- write Feb–Jun (closed) with assertions ----
  for (const key of ["FEB", "MAR", "APR", "MAY", "JUN"]) {
    const d = MONTHS[key];
    const r = await writeMonth(d.y, d.m, d.income, d.expense, "closed", true);
    const ok = r.incSum === d.checkInc && r.expSum === d.checkExp;
    console.log(`${r.label}: income ${r.incSum} (exp ${d.checkInc}) · expense ${r.expSum} (exp ${d.checkExp}) ${ok ? "✓" : "✗ MISMATCH"}`);
    if (!ok) throw new Error(`${r.label} totals mismatch — aborting`);
  }

  // ---- regenerate JULY (open) from June recurring lines, no spends ----
  await prisma.$transaction([
    prisma.spend.deleteMany({ where: { period: { year: JULY.y, month: JULY.m } } }),
    prisma.budget.deleteMany({ where: { period: { year: JULY.y, month: JULY.m } } }),
    prisma.expenseEntry.deleteMany({ where: { period: { year: JULY.y, month: JULY.m } } }),
    prisma.incomeEntry.deleteMany({ where: { period: { year: JULY.y, month: JULY.m } } }),
  ]);
  const jul = await writeMonth(JULY.y, JULY.m, JULY.income, JULY.expense, "open", false);
  console.log(`${jul.label}: income ${jul.incSum} · expense ${jul.expSum} (open working month)`);

  console.log("\n✓ Import complete. Piggy = 0. Members merged. All months match the sheets.");
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
