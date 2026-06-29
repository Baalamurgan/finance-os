import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Seed the household, members, categories and the MAR 2026 roll-up,
// reconstructed from KA_MAR_26.xlsx so totals match the sheet exactly:
//   income 345102 · expense 174451 · balance 170651
// DEV-ONLY: this wipes all tables — never run against prod.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// necessary/other default + sheet section per category. `tracked` = logged in the Expenses tab.
// monthlyBudget = recurring default (template); sinking + cycleMonths = sinking-fund config.
const CATEGORIES: {
  name: string;
  necessary: boolean;
  section: string;
  tracked?: boolean;
  monthlyBudget?: number;
  sinking?: boolean;
  cycleMonths?: number;
  responsible?: string; // member code charged the over-budget excess at wind-down
}[] = [
  { name: "Loan", necessary: true, section: "Loans" },
  { name: "Interest", necessary: true, section: "Loans" },
  { name: "Chit", necessary: true, section: "Chits" },
  { name: "Transport", necessary: true, section: "Monthly" },
  { name: "Household", necessary: true, section: "Monthly" },
  { name: "Provision", necessary: true, section: "Monthly", tracked: true, monthlyBudget: 5000, responsible: "H" },
  { name: "Veg & Fruits", necessary: true, section: "Monthly", tracked: true, monthlyBudget: 5000 },
  { name: "Non-Veg", necessary: true, section: "Monthly", tracked: true, monthlyBudget: 3000 },
  { name: "Petrol", necessary: true, section: "Monthly", tracked: true, monthlyBudget: 12000 },
  { name: "EB", necessary: true, section: "Monthly", tracked: true, monthlyBudget: 1000, sinking: true, cycleMonths: 2 },
  { name: "LPG Gas", necessary: true, section: "Monthly", tracked: true, monthlyBudget: 1000 },
  { name: "WiFi", necessary: true, section: "Monthly", tracked: true, monthlyBudget: 1269, sinking: true, cycleMonths: 3 },
  { name: "Mobile Recharge", necessary: true, section: "Monthly", tracked: true, monthlyBudget: 1541, sinking: true, cycleMonths: 12 },
  { name: "God", necessary: true, section: "Monthly" },
  { name: "Personal/Misc", necessary: false, section: "Misc", tracked: true },
  { name: "Giving/Religious", necessary: false, section: "Misc" },
];

const MEMBERS: {
  name: string;
  code: string;
  isEarner: boolean;
  role?: string;
  email?: string;
}[] = [
  { name: "VL", code: "VL", isEarner: true },
  { name: "Harish", code: "H", isEarner: true },
  { name: "Bala", code: "B", isEarner: true, role: "head", email: "baalamurgan2307@gmail.com" },
  { name: "KA", code: "KA", isEarner: true },
  { name: "Lakshmi", code: "L", isEarner: false },
];

// owner code may be null for household/shared income
const INCOMES: { source: string; amount: number; owner: string | null }[] = [
  { source: "VL Salary", amount: 70000, owner: "VL" },
  { source: "Harish Salary", amount: 79000, owner: "H" },
  { source: "Bala Salary", amount: 79000, owner: "B" },
  { source: "KA Salary", amount: 60000, owner: "KA" },
  { source: "Next Home Rent", amount: 21000, owner: null },
  { source: "Urbanrise Rent", amount: 20000, owner: null },
  { source: "G704 Rent", amount: 16000, owner: null },
  { source: "Extra", amount: 102, owner: null },
];

// member code = attribution tag; necessary omitted ⇒ inherits category default
const EXPENSES: {
  label: string;
  amount: number;
  category: string;
  member: string | null;
  necessary?: boolean;
}[] = [
  { label: "BOB Loan", amount: 61750, category: "Loan", member: "H" },
  { label: "JL1", amount: 6296, category: "Loan", member: null },
  { label: "JL2", amount: 5241, category: "Loan", member: null },
  { label: "JL3", amount: 3139, category: "Loan", member: null },
  { label: "VL-JL-Trustpuram Interest", amount: 6100, category: "Interest", member: "H" },
  { label: "Gillnagar-Harish-JL Interest", amount: 2665, category: "Interest", member: "H" },
  { label: "KA-3L-Interest", amount: 4500, category: "Interest", member: "KA" },
  { label: "EB Amount", amount: 2000, category: "EB", member: "B" },
  { label: "God", amount: 1001, category: "God", member: null },
  { label: "Car Cleaning", amount: 500, category: "Household", member: null },
  { label: "Maintenance-BFC", amount: 1000, category: "Household", member: null },
  { label: "WIFI", amount: 1269, category: "WiFi", member: "B" },
  { label: "Gas", amount: 1000, category: "LPG Gas", member: "B" },
  { label: "Car Petrol", amount: 12000, category: "Petrol", member: "B" },
  { label: "Milk", amount: 625, category: "Household", member: null },
  { label: "VL Van", amount: 3000, category: "Transport", member: "VL" },
  { label: "Servant", amount: 6000, category: "Household", member: null },
  { label: "Mobile Recharges", amount: 1541, category: "Mobile Recharge", member: "B" },
  { label: "Veg & Fruits (allocation)", amount: 5000, category: "Veg & Fruits", member: null },
  { label: "Non-Veg (allocation)", amount: 3000, category: "Non-Veg", member: null },
  { label: "Provision (allocation)", amount: 5000, category: "Provision", member: null },
  { label: "Misc - Bala", amount: 4232, category: "Personal/Misc", member: "B" },
  { label: "Misc - KA", amount: 9092, category: "Personal/Misc", member: "KA" },
  { label: "Vana Marriage Gift", amount: 5000, category: "Giving/Religious", member: "B" },
  { label: "Harish Chit", amount: 8500, category: "Chit", member: "H" },
  { label: "Harish Exp", amount: 10000, category: "Personal/Misc", member: "H" },
  { label: "VL Exp", amount: 5000, category: "Personal/Misc", member: "VL" },
];

// planned budgets present in the sheet (Veg/Non-Veg/Provision allocations)
const BUDGETS: { category: string; planned: number }[] = [
  { category: "Veg & Fruits", planned: 5000 },
  { category: "Non-Veg", planned: 3000 },
  { category: "Provision", planned: 5000 },
  { category: "Petrol", planned: 12000 },
  { category: "WiFi", planned: 1269 },
  { category: "EB", planned: 1000 },
  { category: "Mobile Recharge", planned: 1541 },
  { category: "LPG Gas", planned: 1000 },
  // Personal/Misc has NO budget — unplanned, deducted from next month's income.
];

// Actual logged spends (the daily WhatsApp-group entries) for the Expenses tab.
const SPENDS: { category: string; member: string | null; label: string; amount: number }[] = [
  { category: "Veg & Fruits", member: "KA", label: "Vegetables (market)", amount: 1205 },
  { category: "Veg & Fruits", member: "B", label: "Fruits + Milk + Maavu", amount: 900 },
  { category: "Non-Veg", member: "B", label: "Chicken", amount: 220 },
  { category: "Provision", member: "KA", label: "Monthly provision", amount: 2867 },
  { category: "Petrol", member: "B", label: "Petrol — GPay", amount: 1200 },
  { category: "Personal/Misc", member: "B", label: "Stationery (unplanned)", amount: 432 },
  { category: "LPG Gas", member: "B", label: "Cylinder booked", amount: 928.5 },
  // WiFi / EB / Mobile intentionally have 0 spends → full remainder holds in Piggy (sinking fund).
];

async function main() {
  // idempotent reseed — delete child tables before their parents (FK-safe)
  await prisma.loanPayment.deleteMany();
  await prisma.loan.deleteMany();
  await prisma.settlementRecord.deleteMany();
  await prisma.spend.deleteMany();
  await prisma.piggyEntry.deleteMany();
  await prisma.expenseEntry.deleteMany();
  await prisma.incomeEntry.deleteMany();
  await prisma.budget.deleteMany();
  await prisma.period.deleteMany();
  await prisma.category.deleteMany();
  await prisma.member.deleteMany();
  await prisma.household.deleteMany();

  const household = await prisma.household.create({
    data: { name: "JAI SAI RAM", type: "family" },
  });

  const members = new Map<string, number>();
  for (const m of MEMBERS) {
    const created = await prisma.member.create({
      data: { ...m, householdId: household.id },
    });
    members.set(m.code, created.id);
  }

  const categories = new Map<string, { id: number; necessary: boolean }>();
  for (const c of CATEGORIES) {
    const { responsible, ...catData } = c as typeof c & { responsible?: string };
    const created = await prisma.category.create({
      data: {
        ...catData,
        householdId: household.id,
        responsibleMemberId: responsible ? members.get(responsible) ?? null : null,
      },
    });
    categories.set(c.name, { id: created.id, necessary: c.necessary });
  }

  const period = await prisma.period.create({
    data: { householdId: household.id, year: 2026, month: 3, label: "MAR 2026" },
  });

  for (const i of INCOMES) {
    await prisma.incomeEntry.create({
      data: {
        periodId: period.id,
        source: i.source,
        amount: i.amount,
        ownerId: i.owner ? members.get(i.owner) : null,
      },
    });
  }

  for (const e of EXPENSES) {
    const cat = categories.get(e.category)!;
    await prisma.expenseEntry.create({
      data: {
        periodId: period.id,
        label: e.label,
        amount: e.amount,
        categoryId: cat.id,
        memberId: e.member ? members.get(e.member) : null,
        necessary: e.necessary ?? cat.necessary,
      },
    });
  }

  for (const b of BUDGETS) {
    await prisma.budget.create({
      data: {
        periodId: period.id,
        categoryId: categories.get(b.category)!.id,
        planned: b.planned,
      },
    });
  }

  for (const s of SPENDS) {
    await prisma.spend.create({
      data: {
        periodId: period.id,
        categoryId: categories.get(s.category)!.id,
        memberId: s.member ? members.get(s.member) : null,
        label: s.label,
        amount: s.amount,
      },
    });
  }

  // Loans & chits known from the sheets (head can add the rest / fix balances)
  await prisma.loan.create({
    data: {
      householdId: household.id, name: "KA 3L Loan", kind: "loan",
      outstanding: 300000, monthlyAmount: 4500, memberId: members.get("KA"),
    },
  });
  await prisma.loan.create({
    data: {
      householdId: household.id, name: "Harish Chit", kind: "chit",
      monthlyAmount: 8500, totalInstallments: 20, paidInstallments: 5, memberId: members.get("VL"),
    },
  });

  const income = INCOMES.reduce((s, i) => s + i.amount, 0);
  const expense = EXPENSES.reduce((s, e) => s + e.amount, 0);
  console.log(
    `Seeded MAR 2026 — income ${income}, expense ${expense}, balance ${income - expense}`
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
