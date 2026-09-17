/**
 * READ-ONLY: break down each member's "holding now" for the draft month exactly as the In-Hand card
 * computes it — total (net + pool/piggy/sinking) MINUS pendingCashMove (undone plan cash-moves). For the
 * card owner it itemises every plan step that moves their cash, so we can see precisely what makes up the
 * number. Nothing is written.
 *
 * Run:  node_modules/.bin/tsx scripts/diagnose-holding-now.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(__dirname, "..", ".env.local") });
config({ path: resolve(__dirname, "..", ".env") });
const url = process.env.DATABASE_URL ?? "";
if (!url || !/^postgres/i.test(url)) { console.error("✗ DATABASE_URL missing. Run: vercel env pull .env.local"); process.exit(1); }
const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const { _getInHand, _getSettlement, getMoneyPlan } = await import("../src/lib/queries");
  const { pendingCashMoveByMember } = await import("../src/lib/moneyPlan");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const period = await prisma.period.findFirst({ where: { status: "draft" }, orderBy: [{ year: "desc" }, { month: "desc" }] });
    if (!period) { console.log("No draft period."); return; }
    const household = await prisma.household.findUnique({ where: { id: period.householdId }, select: { treasurerMemberId: true, piggyHolderMemberId: true } });
    const head = await prisma.member.findFirst({ where: { householdId: period.householdId, role: "head" }, select: { id: true } });
    const treasurerId = period.treasurerMemberId ?? household?.treasurerMemberId ?? head?.id ?? null;
    const piggyHolderId = household?.piggyHolderMemberId ?? head?.id ?? null;

    const settlement = await _getSettlement(period.householdId, period.id, treasurerId);
    const inhand = await _getInHand(period.householdId, period.id, settlement);
    const plan = await getMoneyPlan(period.householdId, period.id, inhand, undefined, undefined, settlement);
    const pending = pendingCashMoveByMember(plan.steps);

    console.log(`\n=== ${period.label} · holding-now breakdown ===`);
    console.log(`treasurer=#${treasurerId}  piggyHolder=#${piggyHolderId}  generalPiggy=${inr(inhand.generalPiggy)}  pool=${inr(inhand.treasurerPool)}\n`);

    for (const g of inhand.byPerson) {
      const isTre = g.memberId === inhand.treasurerId;
      const isPig = g.memberId === piggyHolderId;
      const poolAmt = isTre ? inhand.treasurerPool : 0;
      const piggyAmt = isPig ? inhand.generalPiggy - (inhand.pendingPiggyHandover?.lump ?? 0) : 0;
      const total = g.net + poolAmt + piggyAmt + g.sinkingHeld;
      const pcm = g.memberId != null ? pending[g.memberId] ?? 0 : 0;
      const holdingNow = total - pcm;
      const cardHeld = (g.pendingCardBills ?? []).reduce((s, b) => s + b.familyAmount, 0);
      console.log(`── ${g.name} (#${g.memberId}) ── holding now ${inr(holdingNow)}`);
      console.log(`   total ${inr(total)} = net ${inr(g.net)}${isTre ? ` + pool ${inr(poolAmt)}` : ""}${isPig ? ` + piggy ${inr(piggyAmt)}` : ""} + sinkingHeld ${inr(g.sinkingHeld)}`);
      console.log(`     net parts: budgetRemaining ${inr(g.budgetRemaining)} + earmarked ${inr(g.earmarkedTotal)} − misc ${inr(g.miscSpent)} + pendingPiggyHeld ${inr(g.pendingPiggyHeld)} + cardBillsHeld ${inr(cardHeld)} (+ self-funded bills)`);
      if ((g.pendingCardBills ?? []).length) for (const b of g.pendingCardBills!) console.log(`       💳 ${b.cardName} family ${inr(b.familyAmount)} (due ${b.dueISO.slice(0, 10)})`);
      console.log(`   − pendingCashMove ${inr(pcm)} (undone plan cash-moves, +receive/−send):`);
      for (const s of plan.steps) {
        if (s.done || s.hidden) continue;
        const rows: string[] = [];
        if (s.kind === "income" && s.toId === g.memberId) rows.push(`+${inr(s.amount)} income`);
        else if (s.kind === "allowance") { if (s.fromId === g.memberId && s.fromId !== s.toId) rows.push(`−${inr(s.amount)} allowance→${s.toName}`); if (s.poolTwoStep && s.toId === g.memberId) rows.push(`+${inr(s.amount)} pool-misc`); }
        else if ((s.kind === "bill") && s.poolVendorLeg && s.payerId === g.memberId) rows.push(`−${inr(s.amount)} vendor leg`);
        else if (["transfer-in", "transfer-out", "advance", "manual", "pool-handover"].includes(s.kind)) { if (s.fromId === g.memberId) rows.push(`−${inr(s.amount)} → ${s.toName}`); if (s.toId === g.memberId) rows.push(`+${inr(s.amount)} ← ${s.fromName}`); }
        for (const r of rows) console.log(`       day ${String(s.day ?? "—").padStart(2)} ${s.kind.padEnd(12)} ${r}`);
      }
      console.log("");
    }
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
