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

    // ── POOL DERIVATION: build 'Family pool' from raw rows the way getInHand does ──
    //   month balance = Σ IncomeEntry − Σ ExpenseEntry (this month, EVERY expense incl. envelopes)
    //   Family pool   = shared.net + month balance + bills to disburse
    const [incAll, expAll] = await Promise.all([
      prisma.incomeEntry.findMany({ where: { periodId: open.id }, select: { amount: true } }),
      prisma.expenseEntry.findMany({
        where: { periodId: open.id },
        select: { amount: true, memberId: true, category: { select: { tracked: true, fundingStyle: true, isAllowance: true } } },
      }),
    ]);
    const incomeTotal = incAll.reduce((s, i) => s + i.amount, 0);
    const expenseTotal = expAll.reduce((s, e) => s + e.amount, 0);
    const monthBal = incomeTotal - expenseTotal;
    // bucket the expenses so the total is legible (they sum to expenseTotal)
    const B = (label: string, pred: (e: (typeof expAll)[number]) => boolean) => {
      const items = expAll.filter(pred);
      return { label, sum: items.reduce((s, e) => s + e.amount, 0), n: items.length };
    };
    const plain = (e: (typeof expAll)[number]) => !e.category.tracked && e.category.fundingStyle == null && !e.category.isAllowance;
    const buckets = [
      B("budget envelopes (tracked)", (e) => e.category.tracked),
      B("bill-with-fund lines", (e) => !e.category.tracked && e.category.fundingStyle != null),
      B("allowances", (e) => !e.category.tracked && e.category.isAllowance && e.category.fundingStyle == null),
      B("assigned member bills", (e) => plain(e) && e.memberId != null),
      B("shared / pool bills", (e) => plain(e) && e.memberId == null),
    ];
    console.log(`\n══ POOL DERIVATION ══`);
    console.log(`  income (Σ IncomeEntry)   = ${inr(incomeTotal)}`);
    console.log(`  expenses (Σ ExpenseEntry) = ${inr(expenseTotal)}`);
    for (const b of buckets) console.log(`      − ${b.label.padEnd(26)} ${inr(b.sum).padStart(11)}  (${b.n})`);
    console.log(`  ─────────────────────────────`);
    console.log(`  month balance            = ${inr(monthBal)}   ← this should equal the card's 'month bal'`);
    console.log(`  + bills to disburse      = ${inr(grand)}`);
    console.log(`  = Family pool (excl. shared.net) = ${inr(monthBal + grand)}   ← compare to the card's Family pool`);
    console.log(`  (shared.net — unpaid shared bills + shared budget remaining − shared misc — is added on top by the app; usually ~0)`);

    // ── BUDGET ENVELOPES by owner — proves each member's budget (incl. the treasurer's) is INSIDE the
    //    envelope total that month balance already subtracts, so the pool is the after-budget number. ──
    const envRows = await prisma.expenseEntry.findMany({
      where: { periodId: open.id, category: { tracked: true } },
      select: { amount: true, label: true, category: { select: { name: true, responsibleMemberId: true } } },
    });
    const envByOwner = new Map<number | null, { sum: number; items: { name: string; amount: number }[] }>();
    for (const e of envRows) {
      const k = e.category.responsibleMemberId ?? null;
      const g = envByOwner.get(k) ?? { sum: 0, items: [] };
      g.sum += e.amount;
      g.items.push({ name: e.category.name || e.label, amount: e.amount });
      envByOwner.set(k, g);
    }
    console.log(`\n══ BUDGET ENVELOPES by owner (this whole pile is ALREADY subtracted inside month balance) ══`);
    for (const [mid, g] of [...envByOwner.entries()].sort((a, b) => b[1].sum - a[1].sum)) {
      console.log(`  ${(mid == null ? "— unassigned —" : nameOf(mid)).padEnd(12)} ${inr(g.sum).padStart(11)}`);
      for (const it of g.items.sort((a, b) => b.amount - a.amount)) console.log(`      ${inr(it.amount).padStart(9)}  ${it.name}`);
    }

    // ── PREV-MONTH REIMBURSEMENTS: credited in THIS month's settlement (they reduce each member's
    //    transfer to the hub, so the pool physically receives less) but NOT subtracted anywhere in the
    //    in-hand pool. Replicates settlement-core.ts:46-50 — a prev-month spend credits the spender ONLY
    //    for categories that aren't theirs. Their TOTAL is the amount the pool over-states. ──
    const prevMonth = open.month === 1 ? 12 : open.month - 1;
    const prevYear = open.month === 1 ? open.year - 1 : open.year;
    const prevPeriod = await prisma.period.findUnique({ where: { householdId_year_month: { householdId: h.id, year: prevYear, month: prevMonth } } });
    if (!prevPeriod) { console.log(`\n(no previous month — no reimbursements to credit)`); continue; }
    const prevSpends = await prisma.spend.findMany({ where: { periodId: prevPeriod.id }, include: { category: { select: { name: true, responsibleMemberId: true } } } });
    const reimbByMember = new Map<number, number>();
    for (const sp of prevSpends) {
      if (sp.memberId == null) continue;
      if ((sp.category.responsibleMemberId ?? null) === sp.memberId) continue; // own-category spend already credited via its share line
      reimbByMember.set(sp.memberId, (reimbByMember.get(sp.memberId) ?? 0) + sp.amount);
    }
    let reimbTot = 0;
    console.log(`\n══ PREV-MONTH REIMBURSEMENTS (credited in ${open.label} settlement, NOT subtracted from the pool) ══`);
    for (const [mid, sum] of [...reimbByMember.entries()].sort((a, b) => b[1] - a[1])) { reimbTot += sum; console.log(`  ${nameOf(mid).padEnd(12)} ${inr(sum).padStart(11)}`); }
    console.log(`  ─────────────────────────`);
    console.log(`  TOTAL reimbursements     = ${inr(reimbTot)}   ← the pool likely OVER-states held cash by this`);
    console.log(`  pool ${inr(monthBal + grand)} − ${inr(reimbTot)} = ${inr(monthBal + grand - reimbTot)}   ← should match your money-plan figure (~61,322)`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
