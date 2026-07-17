// One-time cleanup for the Mobile Recharge July fund (see conversation):
//  - remove the −1,541 bill-draw and the 3 manual "Set balance" adjustments (net 0),
//  - restate July's BillPayment as fromFund 0 / fromSetAside 1,541 (offset model).
// The out-of-pocket 16,953 is unchanged. Run AFTER db:backup.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

async function main() {
  const mobile = await prisma.category.findFirst({ where: { name: "Mobile Recharge" }, select: { id: true } });
  if (!mobile) throw new Error("Mobile Recharge category not found");

  const before = await prisma.piggyEntry.findMany({ where: { categoryId: mobile.id, kind: "sinking" } });
  console.log(`Deleting ${before.length} Mobile sinking entries (net ${before.reduce((s, e) => s + e.amount, 0)}):`);
  for (const e of before) console.log(`  #${e.id} ${e.amount}  "${e.note ?? ""}"`);
  const del = await prisma.piggyEntry.deleteMany({ where: { categoryId: mobile.id, kind: "sinking" } });
  console.log(`  deleted ${del.count}`);

  const bp = await prisma.billPayment.findFirst({ where: { categoryId: mobile.id } });
  if (!bp) throw new Error("Mobile BillPayment not found");
  const setAside = await prisma.expenseEntry.aggregate({
    where: { categoryId: mobile.id, period: { status: "open" }, OR: [{ label: { endsWith: "(saving)" } }, { label: { endsWith: "(monthly share)" } }] },
    _sum: { amount: true },
  });
  const consumed = Math.round((setAside._sum.amount ?? 0) * 100) / 100; // the July set-aside it used
  console.log(`\nRestating BillPayment #${bp.id}: fromFund 0, fromSetAside ${consumed} (was fromFund ${bp.fromFund}); outOfPocket ${bp.outOfPocket} unchanged`);
  await prisma.billPayment.update({ where: { id: bp.id }, data: { fromFund: 0, fromSetAside: consumed } });

  const after = await prisma.piggyEntry.aggregate({ where: { categoryId: mobile.id, kind: "sinking" }, _sum: { amount: true } });
  console.log(`\nMobile sinking balance now: ${after._sum.amount ?? 0}`);
  console.log("Done. Rebuild the AUG draft to see the recomputed share.");
}
main().finally(() => prisma.$disconnect());
