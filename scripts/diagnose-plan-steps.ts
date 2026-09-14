/**
 * READ-ONLY: dump the ACTUAL computed money-plan steps for the draft (Oct), so we can see exactly
 * what the engine produces for each bill — funded, rerouted from a peer, or flagged unfundable-in-time.
 * Calls the real getMoneyPlan. Nothing is written.
 *
 * Run: node_modules/.bin/tsx scripts/diagnose-plan-steps.ts
 * If it errors on next/cache, paste the error and I'll switch to a pure reconstruction.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { getInHand, getMoneyPlan } from "../src/lib/queries";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

async function main() {
  const period = await prisma.period.findFirst({ where: { status: "draft" }, orderBy: [{ year: "desc" }, { month: "desc" }] });
  if (!period) { console.log("No draft period."); return; }
  const inhand = await getInHand(period.householdId, period.id);
  const plan = await getMoneyPlan(period.householdId, period.id, inhand);
  console.log(`=== ${period.label} plan steps (${plan.steps.length}) · hubShortfall=${inr(plan.hubShortfall)} ===\n`);
  const byDay = [...plan.steps].sort((a, b) => (a.day ?? 99) - (b.day ?? 99));
  for (const s of byDay) {
    const who = s.kind === "bill"
      ? `${s.payerName} pays "${s.vendor}"`
      : `${s.fromName ?? "?"} → ${s.toName ?? "?"}`;
    const flags = [
      s.done ? "DONE" : "",
      s.reroute ? "REROUTE(peer→creditor)" : "",
      s.fundsMember ? "funds-bill" : "",
      s.senderShort != null && s.senderShort > 0.5 ? `SENDER-SHORT ${inr(s.senderShort)}` : "",
      s.short != null && s.short > 0.5 ? `HUB-SHORT ${inr(s.short)}` : "",
      s.infeasibleFrom !== undefined ? `INFEASIBLE-until-day-${s.infeasibleFrom ?? "never"}` : "",
    ].filter(Boolean).join(" · ");
    console.log(`  day ${String(s.day ?? "—").padStart(2)} · ${s.kind.padEnd(12)} ${inr(s.amount).padStart(11)}  ${who}${flags ? "   [" + flags + "]" : ""}`);
  }
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
