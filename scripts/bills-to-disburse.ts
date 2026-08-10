import { config } from "dotenv";
// Prefer .env.local (real DB URL) over .env's stale local file. dotenv won't override
// already-set keys, so loading .env.local first makes it win.
config({ path: ".env.local" });
config();
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// READ-ONLY. Itemises the In-Hand "bills to disburse" figure (poolHoldsForMembers) — the pool cash
// the treasurer still holds for members' UNPAID assigned bills. Reproduces the exact filter getInHand
// uses (queries.ts): expenseEntry with note null, a tracked:false / non-fund / non-allowance category,
// assigned to a real member, and not yet paid. Lists each bill (oldest first = the order added), so
// the sum you see on the card has a line-by-line breakdown. Also prints unpaid SHARED bills separately
// (those live in the pool via `month balance`, NOT in this number) for a complete picture.
// Run: npx tsx scripts/bills-to-disburse.ts
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const d = (dt: Date) => new Date(dt.getTime() + 330 * 60000).toISOString().slice(0, 10); // IST date

async function main() {
  const households = await prisma.household.findMany({ select: { id: true, name: true } });
  for (const h of households) {
    const open = await prisma.period.findFirst({
      where: { householdId: h.id, status: "open" },
      orderBy: [{ year: "asc" }, { month: "asc" }],
    });
    console.log(`\n=== ${h.name} (household ${h.id}) ===`);
    if (!open) { console.log("  no open month"); continue; }
    console.log(`Open month: ${open.label} (period ${open.id})`);

    const [members, billLines] = await Promise.all([
      prisma.member.findMany({ where: { householdId: h.id }, select: { id: true, name: true } }),
      // exact getInHand "bills" filter (queries.ts:798)
      prisma.expenseEntry.findMany({
        where: { periodId: open.id, note: null, category: { tracked: false, fundingStyle: null, isAllowance: false } },
        select: { id: true, label: true, amount: true, paid: true, memberId: true, dueDay: true, createdAt: true, category: { select: { name: true, section: true } } },
        orderBy: { createdAt: "asc" },
      }),
    ]);
    const nameOf = (id: number | null) => members.find((m) => m.id === id)?.name ?? (id == null ? "— shared / pool —" : `member ${id}`);

    // "bills to disburse" = UNPAID bills assigned to a real member. Group by member.
    const assignedUnpaid = billLines.filter((b) => b.memberId != null && !b.paid);
    const byMember = new Map<number, typeof assignedUnpaid>();
    for (const b of assignedUnpaid) {
      const arr = byMember.get(b.memberId!) ?? [];
      arr.push(b);
      byMember.set(b.memberId!, arr);
    }

    let grand = 0;
    console.log(`\n── BILLS TO DISBURSE (unpaid, assigned to a member) ──`);
    for (const [mid, items] of [...byMember.entries()].sort((a, b) => nameOf(a[0]).localeCompare(nameOf(b[0])))) {
      const sub = items.reduce((s, b) => s + b.amount, 0);
      grand += sub;
      console.log(`\n  ${nameOf(mid)} — ${inr(sub)}`);
      for (const b of items) {
        console.log(`    ${d(b.createdAt)}  ${inr(b.amount).padStart(9)}  ${b.label}  [${b.category.section} · due ${b.dueDay ?? "—"}]`);
      }
    }
    console.log(`\n  ────────────────────────────────`);
    console.log(`  TOTAL bills to disburse = ${inr(grand)}`);

    // Context: PAID assigned bills (already disbursed, no longer in the pool) and unpaid SHARED bills.
    const assignedPaid = billLines.filter((b) => b.memberId != null && b.paid);
    const sharedUnpaid = billLines.filter((b) => b.memberId == null && !b.paid);
    const paidSum = assignedPaid.reduce((s, b) => s + b.amount, 0);
    const sharedSum = sharedUnpaid.reduce((s, b) => s + b.amount, 0);
    if (assignedPaid.length) {
      console.log(`\n── already PAID this month (left the pool) — ${inr(paidSum)} ──`);
      for (const b of assignedPaid) console.log(`    ${d(b.createdAt)}  ${inr(b.amount).padStart(9)}  ${nameOf(b.memberId)}: ${b.label}`);
    }
    if (sharedUnpaid.length) {
      console.log(`\n── unpaid SHARED/pool bills (in 'month balance', NOT in the number above) — ${inr(sharedSum)} ──`);
      for (const b of sharedUnpaid) console.log(`    ${d(b.createdAt)}  ${inr(b.amount).padStart(9)}  ${b.label}  [${b.category.section}]`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
