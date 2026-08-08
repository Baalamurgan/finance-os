// One-time fix: July 2026 was already wound down when the piggy-handover migration ran, so its
// backfill wrongly marked it "handed over". Reset it to NULL so July's ₹3,211 leftover shows as a
// pending hand-over (owners → Piggy holder) in August. Safe to re-run. Read-then-write, one row.
//   npx tsx scripts/reset-july-piggy-handover.ts
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

async function main() {
  const { prisma } = await import("@/lib/prisma");
  const rows = await prisma.period.findMany({
    where: { year: 2026, month: 7, status: "closed" },
    select: { id: true, label: true, householdId: true, piggyHandedOverAt: true },
  });
  console.log("July periods:", rows.map((r) => `#${r.id} ${r.label} handed=${r.piggyHandedOverAt ? "yes" : "no"}`).join("  "));
  const res = await prisma.period.updateMany({
    where: { year: 2026, month: 7, status: "closed", piggyHandedOverAt: { not: null } },
    data: { piggyHandedOverAt: null },
  });
  console.log(`Reset ${res.count} July period(s) → pending hand-over.`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
