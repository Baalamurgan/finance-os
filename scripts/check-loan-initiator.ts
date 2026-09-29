/**
 * READ-ONLY: confirm the PersonalLoan.initiatedById column exists in the connected DB and show how many
 * rows carry it. Nothing is written.  Run: node_modules/.bin/tsx scripts/check-loan-initiator.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(__dirname, "..", ".env.local") });
config({ path: resolve(__dirname, "..", ".env") });
const url = process.env.DATABASE_URL ?? "";
if (!url || !/^postgres/i.test(url)) { console.error("✗ DATABASE_URL missing."); process.exit(1); }

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const col = await prisma.$queryRawUnsafe<Array<{ data_type: string; is_nullable: string }>>(
      `SELECT data_type, is_nullable FROM information_schema.columns WHERE table_name='PersonalLoan' AND column_name='initiatedById'`,
    );
    if (col.length === 0) { console.error("✗ Column PersonalLoan.initiatedById does NOT exist — migration not applied."); return; }
    console.log(`✓ Column exists: initiatedById ${col[0].data_type}, nullable=${col[0].is_nullable}`);
    const total = await prisma.personalLoan.count();
    const linked = await prisma.personalLoan.count({ where: { linkGroup: { not: null } } });
    const stamped = await prisma.personalLoan.count({ where: { initiatedById: { not: null } } });
    console.log(`  PersonalLoan rows: ${total} · linked (linkGroup set): ${linked} · initiatedById stamped: ${stamped}`);
    console.log("  (existing linked rows show 0 stamped — expected; they use the legacy fallback. New ones will stamp.)");
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
