import { config } from "dotenv";
config({ path: ".env.local" });
config();
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// READ-ONLY. The COMPLETE position of one member (default: the treasurer) for the open month, built
// from the start: his income in, his own budget/spends/reimbursement, and — if he's treasurer — the
// family pool he merely holds. Reproduces getInHand's exact buckets so the numbers match the card,
// but lays them out as a from-scratch ledger so "his own" vs "held for the family" is unmistakable.
// Run:  npx tsx scripts/arumugam-ledger.ts            (treasurer)
//   or: npx tsx scripts/arumugam-ledger.ts Baala      (any member by name)
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const pad = (n: number) => inr(n).padStart(12);

async function main() {
  const who = process.argv[2] ?? null; // member name; default = treasurer
  const h = await prisma.household.findFirst({ select: { id: true, name: true, treasurerMemberId: true, piggyHolderMemberId: true } });
  if (!h) return console.log("no household");
  const open = await prisma.period.findFirst({ where: { householdId: h.id, status: "open" }, orderBy: [{ year: "asc" }, { month: "asc" }] });
  if (!open) return console.log("no open month");
  const members = await prisma.member.findMany({ where: { householdId: h.id }, select: { id: true, name: true } });
  const nameOf = (id: number | null) => members.find((m) => m.id === id)?.name ?? (id == null ? "—shared—" : `#${id}`);
  const me = who ? members.find((m) => m.name.toLowerCase() === who.toLowerCase()) : members.find((m) => m.id === h.treasurerMemberId);
  if (!me) return console.log(`member "${who}" not found. Members: ${members.map((m) => m.name).join(", ")}`);
  const isTreasurer = me.id === h.treasurerMemberId;

  const [cats, budgets, incomes, spends, incAgg, expAgg] = await Promise.all([
    prisma.category.findMany({ where: { householdId: h.id, onHold: false }, select: { id: true, name: true, tracked: true, responsibleMemberId: true, fundingStyle: true } }),
    prisma.budget.findMany({ where: { periodId: open.id }, select: { categoryId: true, planned: true } }),
    prisma.incomeEntry.findMany({ where: { periodId: open.id, ownerId: me.id }, select: { source: true, amount: true } }),
    prisma.spend.findMany({ where: { periodId: open.id }, select: { categoryId: true, memberId: true, amount: true } }),
    prisma.incomeEntry.aggregate({ where: { periodId: open.id }, _sum: { amount: true } }),
    prisma.expenseEntry.aggregate({ where: { periodId: open.id }, _sum: { amount: true } }),
  ]);
  const planned = new Map(budgets.map((b) => [b.categoryId, b.planned]));
  const budgetedIds = new Set(cats.filter((c) => (planned.get(c.id) ?? 0) > 0).map((c) => c.id));
  const holderOf = new Map(cats.map((c) => [c.id, c.responsibleMemberId ?? null]));
  const fundIds = new Set(cats.filter((c) => c.fundingStyle != null).map((c) => c.id));

  console.log(`\n╔══ ${me.name.toUpperCase()} — full position · ${h.name} · ${open.label}${isTreasurer ? " · TREASURER" : ""} ══╗`);

  // 1) HIS OWN INCOME
  const incomeTot = incomes.reduce((s, i) => s + i.amount, 0);
  console.log(`\n━━ 1. HIS OWN INCOME ━━`);
  for (const i of incomes) console.log(`   ${pad(i.amount)}  ${i.source}`);
  console.log(`   ${"─".repeat(12)}`);
  console.log(`   ${pad(incomeTot)}  total income he entered`);

  // 2) HIS BUDGET ENVELOPES (his to spend, funded from the pool)
  console.log(`\n━━ 2. HIS BUDGET ENVELOPES (his to spend; already taken OUT of the pool) ━━`);
  let alloc = 0, heldSpent = 0;
  for (const c of cats.filter((c) => budgetedIds.has(c.id) && (holderOf.get(c.id) === me.id))) {
    const a = planned.get(c.id) ?? 0;
    const s = spends.filter((sp) => sp.categoryId === c.id && (sp.memberId == null || sp.memberId === me.id)).reduce((t, sp) => t + sp.amount, 0);
    alloc += a; heldSpent += s;
    console.log(`   ${pad(a)}  ${c.name}  · spent ${inr(s)} → ${inr(a - s)} left`);
  }
  console.log(`   ${"─".repeat(12)}`);
  console.log(`   allocated ${inr(alloc)} · spent ${inr(heldSpent)} · REMAINING (he holds) ${inr(alloc - heldSpent)}`);

  // 3) HIS OUT-OF-POCKET THIS MONTH (misc + spends on others'/untracked categories)
  const oop = spends.filter((sp) => sp.memberId === me.id && !fundIds.has(sp.categoryId) && !(budgetedIds.has(sp.categoryId) && holderOf.get(sp.categoryId) === me.id));
  const oopTot = oop.reduce((s, sp) => s + sp.amount, 0);
  console.log(`\n━━ 3. HIS OUT-OF-POCKET THIS MONTH (misc + others' categories) ━━`);
  console.log(`   ${pad(-oopTot)}  (${oop.length} spends) — reduces what he holds`);

  // 4) REIMBURSEMENT OWED TO HIM for last month's out-of-pocket
  const pm = open.month === 1 ? 12 : open.month - 1, py = open.month === 1 ? open.year - 1 : open.year;
  const prev = await prisma.period.findUnique({ where: { householdId_year_month: { householdId: h.id, year: py, month: pm } }, select: { id: true, label: true } });
  let reimb = 0;
  if (prev) {
    const prevSp = await prisma.spend.findMany({ where: { periodId: prev.id, memberId: me.id }, select: { categoryId: true, amount: true } });
    reimb = prevSp.filter((sp) => holderOf.get(sp.categoryId) !== me.id).reduce((s, sp) => s + sp.amount, 0);
  }
  console.log(`\n━━ 4. REIMBURSEMENT OWED TO HIM (last month's out-of-pocket, ${prev?.label ?? "—"}) ━━`);
  console.log(`   ${pad(reimb)}  owed back to him${isTreasurer ? "  ← today this is credited NOWHERE for the treasurer" : "  (nets out of his transfer to the hub)"}`);

  // 5) HIS PIGGY he still holds to hand over
  let piggyHeld = 0;
  if (prev) {
    const prevPer = await prisma.period.findUnique({ where: { id: prev.id }, select: { piggyHandedOverAt: true } });
    if (prevPer && prevPer.piggyHandedOverAt == null) {
      const pe = await prisma.piggyEntry.findMany({ where: { periodId: prev.id, kind: "piggy" }, select: { categoryId: true, amount: true } });
      for (const e of pe) { if (e.categoryId == null || e.amount <= 0.005) continue; const o = holderOf.get(e.categoryId) ?? h.treasurerMemberId; if (o === me.id && o !== h.piggyHolderMemberId) piggyHeld += e.amount; }
    }
  }
  console.log(`\n━━ 5. PIGGY he still holds to hand over ━━\n   ${pad(piggyHeld)}`);

  // 6) THE FAMILY POOL he holds (only if treasurer)
  const monthBal = (incAgg._sum.amount ?? 0) - (expAgg._sum.amount ?? 0);
  const billLines = await prisma.expenseEntry.findMany({ where: { periodId: open.id, note: null, category: { tracked: false, fundingStyle: null, isAllowance: false } }, select: { amount: true, memberId: true, paid: true } });
  const billsToDisburse = billLines.filter((b) => b.memberId != null && !b.paid).reduce((s, b) => s + b.amount, 0);
  const pool = monthBal + billsToDisburse;
  if (isTreasurer) {
    console.log(`\n━━ 6. THE FAMILY POOL he HOLDS (custodial — the family's, not his) ━━`);
    console.log(`   ${pad(incAgg._sum.amount ?? 0)}  all members' income`);
    console.log(`   ${pad(-(expAgg._sum.amount ?? 0))}  all expenses booked (incl. EVERY budget envelope)`);
    console.log(`   ${"─".repeat(12)}`);
    console.log(`   ${pad(monthBal)}  month balance`);
    console.log(`   ${pad(billsToDisburse)}  + unpaid assigned bills he still holds to pay out`);
    console.log(`   ${pad(pool)}  = FAMILY POOL`);
  }

  // 7) WHAT HE PHYSICALLY HOLDS NOW = the app's in-hand
  const own = (alloc - heldSpent) - oopTot + piggyHeld;
  console.log(`\n━━ 7. WHAT ${me.name.toUpperCase()} PHYSICALLY HOLDS NOW (= the app's in-hand) ━━`);
  console.log(`   ${pad(alloc - heldSpent)}  his budget remaining`);
  console.log(`   ${pad(-oopTot)}  his out-of-pocket this month`);
  console.log(`   ${pad(piggyHeld)}  his piggy to hand over`);
  console.log(`   ${pad(own)}  = HIS OWN`);
  if (isTreasurer) {
    console.log(`   ${pad(pool)}  + family pool he holds (custodial)`);
    console.log(`   ${"─".repeat(12)}`);
    console.log(`   ${pad(own + pool)}  = IN-HAND shown on his card`);
    console.log(`\n   NB: reimbursement owed to him (${inr(reimb)}) is in NONE of the above — that's the gap.`);
  } else {
    console.log(`   ${"─".repeat(12)}`);
    console.log(`   ${pad(own)}  = IN-HAND shown on his card`);
  }
  console.log(`\n╚${"═".repeat(60)}╝`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
