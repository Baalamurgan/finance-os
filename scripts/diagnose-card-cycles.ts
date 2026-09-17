/**
 * READ-ONLY: dump every credit card's billing cycles (personal + family split, per cycle) using the
 * PRODUCTION getCardDues logic — so the number here is exactly what the family card-bill feature will
 * compute. Use it to reconcile a real statement (e.g. RBL 16 Aug → 15 Sep should total ₹9,822).
 * Nothing is written.
 *
 * Run from anywhere:  node_modules/.bin/tsx scripts/diagnose-card-cycles.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { existsSync } from "node:fs";

// Load .env.local by ABSOLUTE path FIRST — src/lib/prisma.ts reads DATABASE_URL at IMPORT time, so env
// must be loaded before any src/lib import (hence the dynamic import() in main(), not a top-level one).
const envLocal = resolve(__dirname, "..", ".env.local");
config({ path: envLocal });
config({ path: resolve(__dirname, "..", ".env") });

const url = process.env.DATABASE_URL ?? "";
function describe(u: string): string {
  if (!u) return "(empty / not set)";
  try {
    const p = new URL(u);
    const pw = p.password ? `<${p.password.length} chars>` : "(NONE)";
    return `protocol=${p.protocol} user=${p.username || "(none)"} password=${pw} host=${p.host || "(none)"} db=${p.pathname}`;
  } catch (e) {
    return `UNPARSEABLE as a URL: "${u.slice(0, 24)}…" (${(e as Error).message})`;
  }
}
console.log(`.env.local exists: ${existsSync(envLocal)} (${envLocal})`);
console.log(`DATABASE_URL: ${describe(url)}\n`);
if (!url || !/^postgres/i.test(url) || (() => { try { return !new URL(url).password; } catch { return true; } })()) {
  console.error(
    `✗ DATABASE_URL is missing a usable password.\n` +
      `  Refresh:  vercel env pull .env.local\n` +
      `  Or inline: DATABASE_URL='postgres://…' node_modules/.bin/tsx scripts/diagnose-card-cycles.ts\n`,
  );
  process.exit(1);
}

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const day = (iso: string) => new Date(iso).toISOString().slice(0, 10);

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const { getCardDues } = await import("../src/lib/personal/cash");

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    // Every credit-card owner, so we can run the production due logic per member.
    const cards = await prisma.financeAccount.findMany({
      where: { type: "credit_card" },
      select: { id: true, name: true, memberId: true, member: { select: { name: true } }, credit: { select: { statementDay: true, dueOffsetDays: true } } },
      orderBy: [{ memberId: "asc" }, { sortOrder: "asc" }],
    });
    if (cards.length === 0) { console.log("No credit cards found."); return; }

    const owners = [...new Set(cards.map((c) => c.memberId))];
    for (const ownerId of owners) {
      const ownerName = cards.find((c) => c.memberId === ownerId)?.member.name ?? `#${ownerId}`;
      const dues = await getCardDues(ownerId);
      for (const d of dues) {
        const cfg = cards.find((c) => c.id === d.cardId)?.credit;
        console.log(`\n━━━ ${ownerName} · ${d.cardName} (statementDay=${cfg?.statementDay ?? "—"}, dueOffset=${cfg?.dueOffsetDays ?? "—"}) ━━━`);
        if (d.needsStatementDay) {
          console.log(`  ⚠ no statement day set — can't derive cycles. Ungrouped items:`);
          for (const it of d.ungrouped) console.log(`     ${day(it.dateISO)}  ${it.family ? "[family]" : "[personal]"}  ${inr(it.amount)}  ${it.label}`);
          continue;
        }
        console.log(`  personal unpaid total = ${inr(d.unpaidTotal)}   family (reimbursed) unpaid total = ${inr(d.familyUnpaidTotal)}`);
        for (const c of d.cycles) {
          const combined = c.total + c.familyTotal;
          console.log(`\n  ◦ cycle ending ${day(c.cycleEndISO)}  due ${c.dueISO ? day(c.dueISO) : "—"}`);
          console.log(`      COMBINED bill = ${inr(combined)}   (personal ${inr(c.total)} + family ${inr(c.familyTotal)})`);
          const byCat = new Map<string, number>();
          for (const it of c.items) {
            const key = `${it.family ? "family" : "personal"}`;
            byCat.set(key, (byCat.get(key) ?? 0) + it.amount);
          }
          for (const it of [...c.items].sort((a, b) => a.dateISO.localeCompare(b.dateISO))) {
            console.log(`        ${day(it.dateISO)}  ${it.family ? "[family]  " : "[personal]"}  ${inr(it.amount).padStart(9)}  ${it.label}`);
          }
        }
      }
    }
    console.log("");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
