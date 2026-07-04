// DRY-RUN: build next month from the latest period using clonePeriodInto, print
// what the sheet + settlement tags would look like, then ROLL BACK. Writes nothing.
//   set -a; source .env.local; set +a; npx tsx scripts/validate-clone.ts
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { clonePeriodInto } from "../src/lib/periodClone";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

async function main() {
  const h = await prisma.household.findFirst();
  if (!h) throw new Error("no household");
  const latest = await prisma.period.findFirst({ where: { householdId: h.id }, orderBy: [{ year: "desc" }, { month: "desc" }] });
  if (!latest) throw new Error("no period");
  const members = await prisma.member.findMany({ where: { householdId: h.id } });
  const nameOf = (id: number | null) => (id == null ? "— shared/pool" : members.find((m) => m.id === id)?.name ?? "?");

  console.log(`Source: ${latest.label}\n`);
  try {
    await prisma.$transaction(async (tx) => {
      const p = await tx.period.create({ data: { householdId: h.id, year: 2099, month: 12, label: "DRYRUN" } });
      await clonePeriodInto(tx, latest.id, p.id, h.id);
      const [inc, exp, bud] = await Promise.all([
        tx.incomeEntry.findMany({ where: { periodId: p.id } }),
        tx.expenseEntry.findMany({ where: { periodId: p.id }, include: { category: true } }),
        tx.budget.findMany({ where: { periodId: p.id }, include: { category: true } }),
      ]);

      console.log(`Income: ${inc.length} lines · ₹${inc.reduce((s, i) => s + i.amount, 0).toLocaleString("en-IN")}\n`);
      console.log("EXPENSE LINES → settlement tag:");
      for (const e of exp.sort((a, b) => a.category.section.localeCompare(b.category.section) || a.label.localeCompare(b.label)))
        console.log(`  [${e.category.section}] ${e.label.padEnd(30)} ₹${String(e.amount).padStart(7)}  → ${nameOf(e.memberId)}`);
      console.log(`\n  expense total: ₹${exp.reduce((s, e) => s + e.amount, 0).toLocaleString("en-IN")}`);
      console.log(`\nBUDGETS (tracked): ${bud.map((b) => `${b.category.name} ₹${b.planned}`).join(" · ")}`);

      // per-member settlement preview (contributed − tagged expenses)
      console.log("\nPer-member tagged expense (what settlement would subtract):");
      for (const m of members) {
        const t = exp.filter((e) => e.memberId === m.id).reduce((s, e) => s + e.amount, 0);
        if (t) console.log(`  ${m.name.padEnd(12)} ₹${t.toLocaleString("en-IN")}`);
      }
      throw new Error("__ROLLBACK__");
    });
  } catch (e) {
    if ((e as Error).message !== "__ROLLBACK__") throw e;
    console.log("\n✓ dry-run complete — rolled back, nothing written.");
  }
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
