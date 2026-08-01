import { config } from "dotenv";
config({ path: ".env.local" });
config();
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Deletes a DRAFT period by id, but ONLY if it's genuinely a draft with no real activity
// (no spends / settlements / piggy moves) — a spurious next-month preview spawned while two
// months were open. DRY RUN unless `--apply`. Pass the id: `--id=46`.
//   npx tsx scripts/delete-spurious-draft.ts --id=46
//   npx tsx scripts/delete-spurious-draft.ts --id=46 --apply
const APPLY = process.argv.includes("--apply");
const idArg = process.argv.find((a) => a.startsWith("--id="));
const targetId = idArg ? Number(idArg.split("=")[1]) : NaN;
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

async function main() {
  if (!targetId) { console.log("Pass --id=<periodId>"); return; }
  const p = await prisma.period.findUnique({ where: { id: targetId }, select: { id: true, label: true, status: true, householdId: true } });
  if (!p) { console.log(`No period id ${targetId}`); return; }
  const [spends, settle, piggy] = await Promise.all([
    prisma.spend.count({ where: { periodId: p.id } }),
    prisma.settlementRecord.count({ where: { periodId: p.id } }),
    prisma.piggyEntry.count({ where: { periodId: p.id } }),
  ]);
  console.log(`${p.label} (id ${p.id}) status=${p.status} · spends=${spends} settlements=${settle} piggy=${piggy}`);
  if (p.status !== "draft") { console.log("  REFUSED: not a draft — will not delete."); return; }
  if (spends + settle + piggy > 0) { console.log("  REFUSED: has real activity — will not delete."); return; }
  console.log(APPLY ? "  APPLYING: deleting draft + its generated rows…" : "  DRY RUN (pass --apply to delete)");
  if (APPLY) {
    await prisma.$transaction(async (tx) => {
      await tx.settlementRecord.deleteMany({ where: { periodId: p.id } });
      await tx.piggyEntry.deleteMany({ where: { periodId: p.id } });
      await tx.spend.deleteMany({ where: { periodId: p.id } });
      await tx.budget.deleteMany({ where: { periodId: p.id } });
      await tx.expenseEntry.deleteMany({ where: { periodId: p.id } });
      await tx.incomeEntry.deleteMany({ where: { periodId: p.id } });
      await tx.period.delete({ where: { id: p.id } });
    });
    console.log("  ✓ deleted");
  }
}
main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
