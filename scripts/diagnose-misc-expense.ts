import { config } from "dotenv";
config({ path: ".env.local" });
config();
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// READ-ONLY. Dumps the OPEN month's non-trivial expense lines with their note/pool flag, so we can see
// whether a "pool-funded" misc actually carries note="__pool__" (→ a clean treasurer→member allowance
// step) or was saved as a normal member bill (→ netted into settlement, disbursed in pieces).
// Run:  npx tsx scripts/diagnose-misc-expense.ts
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

async function main() {
  const h = await prisma.household.findFirst({ select: { id: true } });
  if (!h) return console.log("no household");
  const periods = await prisma.period.findMany({ where: { householdId: h.id, status: "open" }, select: { id: true, label: true }, orderBy: [{ year: "asc" }, { month: "asc" }] });
  const members = await prisma.member.findMany({ where: { householdId: h.id }, select: { id: true, name: true } });
  const nm = (id: number | null) => (id == null ? "Shared" : members.find((m) => m.id === id)?.name ?? `#${id}`);

  for (const p of periods) {
    console.log(`\n━━ ${p.label} (open) ━━`);
    const exps = await prisma.expenseEntry.findMany({
      where: { periodId: p.id, OR: [{ amount: { gte: 5000 } }, { note: { not: null } }] },
      select: { id: true, label: true, amount: true, memberId: true, dueDay: true, note: true, oneOff: true, category: { select: { name: true, section: true, isAllowance: true } } },
      orderBy: { amount: "desc" },
    });
    if (exps.length === 0) { console.log("  (no large / marked expense lines)"); continue; }
    for (const e of exps) {
      const pool = e.note === "__pool__" ? "  ✅ POOL-FUNDED (treasurer→member allowance)" : e.note ? `  note=${e.note}` : "";
      console.log(`  ₹${e.amount}  ${e.label}  → ${nm(e.memberId)}  [${e.category.name} · ${e.category.section}]  due=${e.dueDay ?? "—"}${pool}`);
    }
  }
  console.log("");
}

main().finally(() => prisma.$disconnect());
