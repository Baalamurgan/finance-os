/**
 * READ-ONLY: dump the ACTUAL computed money-plan steps for the draft month (Oct), so we can see exactly
 * what the funding engine produces for each bill — hub-funded, rerouted, budget-loaned, or short.
 * Nothing is written.
 *
 * Run from anywhere:  node_modules/.bin/tsx scripts/diagnose-plan-steps.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { existsSync } from "node:fs";

// Load .env.local by ABSOLUTE path FIRST (from this file's dir), so it works no matter which directory
// you run from. CRITICAL: src/lib/prisma.ts reads process.env.DATABASE_URL at IMPORT time, so we must
// load env before importing anything under src/lib — hence the dynamic import() in main(), not a static
// top-of-file import (those are hoisted above this config() and would capture an empty password).
const envLocal = resolve(__dirname, "..", ".env.local");
config({ path: envLocal });
config({ path: resolve(__dirname, "..", ".env") });

// Masked diagnosis of what actually loaded — no secret is printed (password shown only as its length).
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
console.log(`DATABASE_URL: ${describe(url)}`);
if (!url || !/^postgres/i.test(url) || (() => { try { return !new URL(url).password; } catch { return true; } })()) {
  console.error(
    `\n✗ DATABASE_URL is missing a usable password (see above).\n` +
      `  Refresh your local copy:  vercel env pull .env.local\n` +
      `  Or run this one script with the URL inline:\n` +
      `    DATABASE_URL='postgres://USER:PASSWORD@HOST:PORT/DB' node_modules/.bin/tsx scripts/diagnose-plan-steps.ts\n`,
  );
  process.exit(1);
}

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

async function main() {
  // Dynamic imports AFTER env is loaded, so src/lib/prisma.ts builds its adapter with the real URL.
  const { PrismaClient } = await import("@prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const { _getInHand, _getSettlement, getMoneyPlan } = await import("../src/lib/queries");

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const period = await prisma.period.findFirst({ where: { status: "draft" }, orderBy: [{ year: "desc" }, { month: "desc" }] });
    if (!period) { console.log("No draft period."); return; }
    // Resolve the treasurer the same way production does (period → household → head).
    const household = await prisma.household.findUnique({ where: { id: period.householdId }, select: { treasurerMemberId: true } });
    const head = await prisma.member.findFirst({ where: { householdId: period.householdId, role: "head" }, select: { id: true } });
    const treasurerId = period.treasurerMemberId ?? household?.treasurerMemberId ?? head?.id ?? null;
    // Uncached settlement + inhand (the cached getSettlement/getInHand need the Next runtime and throw in
    // a plain node script). Thread the same settlement into both, and into getMoneyPlan — the computed
    // steps are then identical to production.
    const settlement = await _getSettlement(period.householdId, period.id, treasurerId);
    const inhand = await _getInHand(period.householdId, period.id, settlement);
    const plan = await getMoneyPlan(period.householdId, period.id, inhand, undefined, undefined, settlement);

    console.log(`\n=== ${period.label} plan (${plan.steps.length} steps · ${plan.shortBills} short bill${plan.shortBills === 1 ? "" : "s"} · hubShortfall=${inr(plan.hubShortfall)}) ===\n`);
    const byDay = [...plan.steps].sort((a, b) => (a.day ?? 99) - (b.day ?? 99));
    for (const s of byDay) {
      const who = s.kind === "bill"
        ? `${s.payerName} pays "${s.vendor}"`
        : `${s.fromName ?? "?"} → ${s.toName ?? "?"}`;
      const flags = [
        s.done ? "DONE" : "",
        s.reroute ? "REROUTE(peer→creditor direct)" : "",
        s.budgetLoan ? `BUDGET-LOAN(returned by ${s.returnBy ?? "?"})` : "",
        s.budgetPayback ? "BUDGET-RETURNED" : "",
        s.fundsMember ? "funds-bill" : "",
        s.senderShort != null && s.senderShort > 0.5 ? `BILL-SHORT ${inr(s.senderShort)}` : "",
        s.infeasibleFrom !== undefined ? `payable-from-day-${s.infeasibleFrom ?? "never"}` : "",
      ].filter(Boolean).join(" · ");
      console.log(`  day ${String(s.day ?? "—").padStart(2)} · ${s.kind.padEnd(12)} ${inr(s.amount).padStart(12)}  ${who}${flags ? "   [" + flags + "]" : ""}`);
    }
    console.log("");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
