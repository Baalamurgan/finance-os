/**
 * READ-ONLY (you run this): the general Piggy balance and WHERE it came from — the whole point being to
 * see whether your fuel under-spend (≈₹3,969 from Jul+Aug) has already swept into Piggy (→ it's already
 * counted, add ₹0) or hasn't (→ that's the amount to add). Groups the Piggy ledger by source category,
 * highlights Fuel, and lists the Fuel entries. Also shows sinking-fund holds separately.
 *
 * Run: node_modules/.bin/tsx scripts/diagnose-piggy.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(__dirname, "..", ".env.local") });
config({ path: resolve(__dirname, "..", ".env") });

const url = process.env.DATABASE_URL ?? "";
if (!url || !/^postgres/i.test(url)) { console.error("✗ DATABASE_URL missing/invalid. Run: vercel env pull .env.local"); process.exit(1); }
const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const pad = (s: string, n: number) => s.padStart(n);

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const household = await prisma.household.findFirst({ select: { id: true, name: true, piggyHolderMemberId: true } });
    if (!household) { console.error("✗ No household."); return; }
    const holder = household.piggyHolderMemberId
      ? await prisma.member.findUnique({ where: { id: household.piggyHolderMemberId }, select: { name: true } })
      : null;
    console.log(`Household: ${household.name}  ·  Piggy holder: ${holder?.name ?? "(head, default)"}\n`);

    const entries = await prisma.piggyEntry.findMany({
      where: { householdId: household.id },
      select: { kind: true, amount: true, note: true, categoryId: true, category: { select: { name: true } }, period: { select: { year: true, month: true, label: true } } },
      orderBy: { createdAt: "asc" },
    });

    const piggy = entries.filter((e) => e.kind !== "sinking"); // general Piggy
    const sinking = entries.filter((e) => e.kind === "sinking");

    // General Piggy, grouped by source category
    const byCat = new Map<string, number>();
    for (const e of piggy) {
      const k = e.category?.name ?? "(no category)";
      byCat.set(k, (byCat.get(k) ?? 0) + e.amount);
    }
    const generalTotal = piggy.reduce((s, e) => s + e.amount, 0);

    console.log("GENERAL PIGGY — by source category");
    console.log(" ─────────────────────────────────────────");
    for (const [name, amt] of [...byCat.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${name.padEnd(24)} ${pad(inr(amt), 10)}`);
    }
    console.log(" ─────────────────────────────────────────");
    console.log(`  ${"TOTAL general Piggy".padEnd(24)} ${pad(inr(generalTotal), 10)}\n`);

    // Fuel-specific detail — the number you care about
    const fuelName = [...byCat.keys()].find((n) => /fuel|petrol/i.test(n));
    if (fuelName) {
      const fuelEntries = piggy.filter((e) => e.category?.name === fuelName);
      const fuelTotal = fuelEntries.reduce((s, e) => s + e.amount, 0);
      console.log(`FUEL → Piggy: ${inr(fuelTotal)} across ${fuelEntries.length} entr${fuelEntries.length === 1 ? "y" : "ies"}`);
      for (const e of fuelEntries) {
        const when = e.period ? (e.period.label ?? `${e.period.year}-${String(e.period.month).padStart(2, "0")}`) : "—";
        console.log(`   ${when.padEnd(12)} ${pad(inr(e.amount), 9)}${e.note ? `  ${e.note}` : ""}`);
      }
      console.log(`\n→ Compare with the ₹3,969 Jul+Aug fuel under-spend:`);
      console.log(`   if this ≈ ₹3,969, it's ALREADY in Piggy → add ₹0.`);
      console.log(`   if it's ₹0 / less, the gap is what still needs adding.\n`);
    } else {
      console.log("FUEL → Piggy: ₹0 (no Fuel-sourced Piggy entries found).");
      console.log("→ So the ₹3,969 under-spend has NOT swept into Piggy — that's the amount to add.\n");
    }

    if (sinking.length > 0) {
      const sinkByCat = new Map<string, number>();
      for (const e of sinking) sinkByCat.set(e.category?.name ?? "(no category)", (sinkByCat.get(e.category?.name ?? "(no category)") ?? 0) + e.amount);
      console.log("SINKING FUNDS (held separately, not general Piggy)");
      for (const [name, amt] of [...sinkByCat.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${name.padEnd(24)} ${pad(inr(amt), 10)}`);
      console.log("");
    }
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
