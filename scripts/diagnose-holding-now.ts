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
  const { pendingCashMoveByMember, doneCashMoveByMember } = await import("../src/lib/moneyPlan");
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
    const done = doneCashMoveByMember(plan.steps);

    console.log(`\n=== ${period.label} · holding-now breakdown ===`);
    console.log(`treasurer=#${treasurerId}  piggyHolder=#${piggyHolderId}  generalPiggy=${inr(inhand.generalPiggy)}  pool=${inr(inhand.treasurerPool)}\n`);

    for (const g of inhand.byPerson) {
      const isTre = g.memberId === inhand.treasurerId;
      const isPig = g.memberId === piggyHolderId;
      const poolAmt = isTre ? inhand.treasurerPool : 0;
      const piggyAmt = isPig ? inhand.generalPiggy - (inhand.pendingPiggyHandover?.lump ?? 0) : 0;
      const total = g.net + poolAmt + piggyAmt + g.sinkingHeld;
      const pcm = g.memberId != null ? pending[g.memberId] ?? 0 : 0;
      const holdingNow = Math.round((total - pcm) * 100) / 100; // app's current holding-now (projection)
      // "expected by month-end" = carry-forward: (treasurer pool RESIDUAL, i.e. minus what he'll disburse
      // to members) + piggy + sinking + set-asides + pending hand-overs − misc.
      const poolForExpected = isTre ? poolAmt - inhand.poolHoldsForMembers : 0;
      const periodicBillsDue = g.unpaidPeriodic.reduce((s, b) => s + b.bill, 0); // set-aside/fund bills due this month
      const expected = Math.round((poolForExpected + piggyAmt + g.sinkingHeld + g.earmarkedTotal + g.pendingPiggyHeld - g.miscSpent - periodicBillsDue) * 100) / 100;
      console.log(`── ${g.name} (#${g.memberId}) ── holding now ${inr(holdingNow)}   EXPECTED(carry-fwd) ${inr(expected)}`);
      console.log(`     expected parts: pool ${inr(poolAmt)} + piggy ${inr(piggyAmt)} + sinking ${inr(g.sinkingHeld)} + set-asides ${inr(g.earmarkedTotal)} + pendingPiggy ${inr(g.pendingPiggyHeld)} − misc ${inr(g.miscSpent)}  (budgets/bills/cards EXCLUDED)`);
      console.log("");
    }
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
