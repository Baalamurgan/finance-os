/**
 * READ-ONLY: explain every member's "↩ Fronted this month" line on the In-Hand card for the CURRENT
 * (IST) open month. Mirrors src/app/in-hand/page.tsx (props) + src/components/InHandPersonGroup.tsx
 * (holdingNow walk vs the labelled "Held for" lines) and prints each term, so the remainder
 * (holdingNow − labelled) can be traced to the exact item. Nothing is written.
 *
 * Run against prod:   ENV_FILE=.env node_modules/.bin/tsx scripts/diagnose-fronted.ts [year month]
 * (ENV_FILE = whichever env file holds the PROD DATABASE_URL; only the DB host is printed.)
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(__dirname, "..", process.env.ENV_FILE ?? ".env") });
const url = process.env.DATABASE_URL ?? "";
if (!url || !/^postgres/i.test(url)) { console.error("✗ DATABASE_URL missing in", process.env.ENV_FILE ?? ".env"); process.exit(1); }
const host = (() => { try { return new URL(url.replace(/^postgres(ql)?:/, "http:")).host; } catch { return "?"; } })();
const r2 = (n: number) => Math.round(n * 100) / 100;
const inr = (n: number) => (n < 0 ? "−₹" : "₹") + Math.abs(r2(n)).toLocaleString("en-IN");
const OWED_OTHERS_MARKER = "owed-others settlement";

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const { _getInHand, _getSettlement, getMoneyPlan } = await import("../src/lib/queries");
  const { doneCashMoveByMember } = await import("../src/lib/moneyPlan");
  const { piggyHeldParts } = await import("../src/lib/piggyHeld");
  const { ownerChargeActiveFor } = await import("../src/lib/settlement-core");
  const { istDateParts } = await import("../src/lib/time");
  const { memberFlows, allocate } = await import("../src/lib/inHandCoverage");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  console.log(`DB host: ${host}  (read-only)`);
  try {
    const ist = istDateParts();
    const y = Number(process.argv[2]) || ist.year;
    const m = Number(process.argv[3]) || ist.month;
    const period = await prisma.period.findFirst({ where: { year: y, month: m } });
    if (!period) { console.log(`No period ${m}/${y}.`); return; }
    const household = await prisma.household.findUnique({ where: { id: period.householdId }, select: { treasurerMemberId: true, piggyHolderMemberId: true } });
    const head = await prisma.member.findFirst({ where: { householdId: period.householdId, role: "head" }, select: { id: true } });
    const treasurerId = period.treasurerMemberId ?? household?.treasurerMemberId ?? head?.id ?? null;

    const settlement = await _getSettlement(period.householdId, period.id, treasurerId);
    const inHand = await _getInHand(period.householdId, period.id, settlement);
    const plan = await getMoneyPlan(period.householdId, period.id, inHand, undefined, undefined, settlement);
    const open = period.status === "open";
    const isPreview = period.status === "draft";
    const done = doneCashMoveByMember(plan.steps);

    // ── page.tsx prop derivation (verbatim logic) ──
    const incomeReceived: Record<number, boolean> = {};
    const incomeSteps = plan.steps.filter((s) => s.kind === "income" && !s.hidden);
    const allIncomeReceived = incomeSteps.length > 0 && incomeSteps.every((s) => s.done);
    const toTre: Record<number, number> = {};
    const manIn: Record<number, number> = {};
    const manOut: Record<number, number> = {};
    for (const s of plan.steps) {
      if (s.kind === "income" && s.done && s.toId != null) incomeReceived[s.toId] = true;
      if (!s.done && s.fromId != null && s.toId === inHand.treasurerId && (s.kind === "transfer-in" || s.kind === "transfer-out" || s.kind === "pool-handover")) toTre[s.fromId] = r2((toTre[s.fromId] ?? 0) + s.amount);
      if (s.kind === "manual" && s.done) {
        if (s.toId != null) manIn[s.toId] = (manIn[s.toId] ?? 0) + s.amount;
        if (s.fromId != null) manOut[s.fromId] = (manOut[s.fromId] ?? 0) + s.amount;
      }
    }
    const routing: Record<number, number> = {};
    for (const g of inHand.byPerson) {
      if (g.memberId == null || g.memberId === inHand.treasurerId) continue;
      const a = manIn[g.memberId] ?? 0, b = manOut[g.memberId] ?? 0;
      if (a > 0.005 && b > 0.005) routing[g.memberId] = r2(a - b);
      else if (a <= 0.005 && b > 0.005 && (toTre[g.memberId] ?? 0) > 0.005) toTre[g.memberId] = Math.max(0, r2((toTre[g.memberId] ?? 0) - b));
    }
    const kept: Record<number, { label: string; amount: number }[]> = {};
    for (const a of inHand.allowances) { if (!a.done || a.vendorLeg) continue; (kept[a.recipientId] ??= []).push({ label: a.label, amount: a.amount }); }
    const owedSettled: Record<number, number> = {};
    if (inHand.treasurerId != null) for (const g of inHand.byPerson) {
      if (g.memberId == null || g.memberId === inHand.treasurerId) continue;
      const owed = g.carryParts?.others ?? 0;
      if (owed <= 0.005) continue;
      let d = 0;
      for (const s of plan.steps) if (s.done && s.kind === "manual" && s.fromId === g.memberId && s.toId === inHand.treasurerId && (s.note ?? "").toLowerCase().includes(OWED_OTHERS_MARKER)) d += s.amount;
      owedSettled[g.memberId] = Math.min(owed, r2(d));
    }
    const ownerChargeActive = ownerChargeActiveFor(period.year, period.month);

    console.log(`\n=== ${period.label} (${period.status}) · treasurer #${inHand.treasurerId} · piggy holder #${inHand.piggyHolderId} · all income in: ${allIncomeReceived} ===`);

    for (const group of inHand.byPerson) {
      const id = group.memberId;
      if (id == null) continue;
      const isTreasurer = id === inHand.treasurerId;
      const isPiggyHolder = id === inHand.piggyHolderId;
      const incRecv = incomeReceived[id] ?? false;
      const doneCashMove = done[id] ?? 0;
      // ── component logic ──
      const piggyAmt = isPiggyHolder ? inHand.generalPiggy - (inHand.pendingPiggyHandover?.lump ?? 0) : 0;
      const sweptToPiggy = group.carryParts?.swept ?? 0;
      const piggyHandedOver = inHand.piggyHandoverStep?.done ?? false;
      const piggyGone = group.openingCarry != null && !isPreview && (isPiggyHolder ? piggyAmt <= 0.005 : piggyHandedOver);
      const parts = piggyHeldParts({ swept: sweptToPiggy, pendingPiggyHeld: group.pendingPiggyHeld, isHolder: isPiggyHolder, piggyGone });
      const setAsideConsumedCash = group.setAsideConsumedCash ?? 0;
      const sweptOut = group.openingCarry != null && !isPreview && parts.sweptOut ? sweptToPiggy : 0;
      if (group.openingCarry == null || isPreview) { console.log(`\n── ${group.name}: no opening carry (closed/preview) — card uses the static total, no remainder line.`); continue; }
      const holdingNow = r2(group.openingCarry + doneCashMove - (group.cashSpent ?? 0) + piggyAmt - sweptOut - setAsideConsumedCash);

      const carriedOnCard = group.carryParts?.onCard ?? 0;
      const carriedOthers = (isTreasurer || ownerChargeActive) ? 0 : Math.max(0, (group.carryParts?.others ?? 0) - (owedSettled[id] ?? 0));
      const carriedFreeHeld = parts.carriedFreeHeld;
      const budgetsTotal = group.cats.reduce((s, c) => s + c.remaining, 0);
      const give = incRecv ? (toTre[id] ?? 0) : 0;
      const heldCardTotal = (group.pendingCardBills ?? []).filter((b) => !b.done).reduce((s, b) => s + b.familyAmount, 0);
      const shownBills = group.unpaidBills.filter((b) => !b.hidden);
      const heldBillsTotal = group.selfFundsBills ? r2(shownBills.reduce((s, b) => s + b.amount, 0) + heldCardTotal) : 0;
      const bills = incRecv ? heldBillsTotal : 0;
      const monthBal = isTreasurer && allIncomeReceived ? inHand.monthBalance : 0;
      const keptTotal = (kept[id] ?? []).reduce((s, a) => s + a.amount, 0);
      const budgetedNames = new Set(group.cats.map((c) => c.name));
      const spentLines = (group.cashByCat ?? []).filter((sp) => !budgetedNames.has(sp.name) && sp.amount > 0.005);
      const subtractedTotal = r2(spentLines.reduce((s, sp) => s + sp.amount, 0));
      const earmarked = incRecv ? group.earmarkedTotal : 0;
      const labeled = carriedOnCard + carriedOthers + carriedFreeHeld + group.sinkingHeld + piggyAmt + group.pendingPiggyHeld + (incRecv ? budgetsTotal : 0) + earmarked + give + bills + (routing[id] ?? 0) + monthBal + keptTotal - subtractedTotal;
      const remainder = r2(holdingNow - labeled);

      console.log(`\n── ${group.name} (#${id})${isTreasurer ? " TREASURER" : ""}${isPiggyHolder ? " PIGGY" : ""} ── income step done: ${incRecv}`);
      console.log(`  HOLDING NOW ${inr(holdingNow)} = opening ${inr(group.openingCarry)} + done moves ${inr(doneCashMove)} − cash spent ${inr(group.cashSpent ?? 0)} + piggy ${inr(piggyAmt)} − swept→piggy ${inr(sweptOut)} − set-aside consumed ${inr(setAsideConsumedCash)}`);
      console.log(`    opening carry parts: ${JSON.stringify(group.carryParts)}`);
      console.log(`    plan steps touching ${group.name} (✓ done / · pending; [x] = not in the cash walk):`);
      for (const s of plan.steps) {
        const isBill = s.kind === "bill" && s.payerId === id;
        if (!isBill && s.fromId !== id && s.toId !== id) continue;
        const dir = isBill ? "BILL" : s.toId === id && s.fromId === id ? "self" : s.toId === id ? "IN  " : "OUT ";
        const skip = s.hidden || s.paidPriorMonth || (s.kind === "bill" && (s.fund || s.miscCard)) || s.kind === "piggy" || (s.kind === "pool-handover" && (s.piggyIncomeIds?.length ?? 0) > 0 && s.fromId === id);
        const flags = [s.fund && "fund", s.miscCard && "miscCard", s.cardBill && "cardBill", s.paidPriorMonth && "paidPriorMonth", s.hidden && "hidden", s.reroute && "direct", s.fundsMember && "fundsMember"].filter(Boolean).join(",");
        console.log(`      ${s.done ? "✓" : "·"} ${dir} ${s.kind.padEnd(13)} ${inr(s.amount).padStart(11)}${skip ? " [x]" : "    "} day ${s.day ?? "-"}  ${s.source ?? s.vendor ?? ""}${s.fromId != null && s.toId != null ? `  (#${s.fromId}→#${s.toId})` : ""}${flags ? `  {${flags}}` : ""}  key=${s.id}`);
      }
      console.log(`    pending card bills: ${JSON.stringify((group.pendingCardBills ?? []).map((b) => ({ fam: b.familyAmount, done: b.done, ...("cycleEndISO" in b ? { cycle: (b as { cycleEndISO?: string }).cycleEndISO } : {}) })))}`);
      for (const s of plan.steps) if (s.cardBill && s.payerId === id) console.log(`    card bill step ${s.vendor}: total ${inr(s.amount)} · personal ${inr(s.cardPersonal ?? 0)} · family budgeted ${inr(s.cardFamilyBudgeted ?? 0)} by month ${JSON.stringify(s.cardFamilyBudgetedByMonth ?? [])} · family misc ${inr(s.cardFamilyMisc ?? 0)} · due ${s.dueISO}`);
      // Own-budget credit-card spends still unpaid, by card and by spend month (what the carry should hold).
      {
        const own = await prisma.spend.findMany({
          where: { memberId: id, cardAccount: { type: "credit_card" }, period: { householdId: period.householdId, OR: [{ year: { gt: period.year - 1 } }] }, category: { responsibleMemberId: id, tracked: true } },
          select: { amount: true, createdAt: true, period: { select: { label: true, year: true, month: true } }, cardAccount: { select: { name: true } } },
        });
        const agg = new Map<string, number>();
        for (const sp of own) { if (sp.period.year * 12 + sp.period.month < period.year * 12 + period.month - 3) continue; const k = `${sp.cardAccount?.name} · ${sp.period.label}`; agg.set(k, r2((agg.get(k) ?? 0) + sp.amount)); }
        if (agg.size) console.log(`    own-budget card spends (last 3 months): ${[...agg].map(([k, v]) => `${k} ${inr(v)}`).join(" | ")}`);
      }
      console.log(`    unpaid bills: ${group.unpaidBills.map((b) => `${b.name} ${inr(b.amount)}`).join(", ") || "—"} · paid bills: ${group.paidBills.map((b) => `${b.name} ${inr(b.amount)}`).join(", ") || "—"}`);
      console.log(`    settlement net (+ gives / − receives): ${inr(settlement.rows.find((r) => r.id === id)?.net ?? NaN)}  yetToReceive ${inr(group.yetToReceive ?? 0)}`);
      console.log(`    cash spends by category: ${(group.cashByCat ?? []).map((c) => `${c.name} ${inr(c.amount)}`).join(", ") || "—"}`);
      console.log(`  HELD FOR ${inr(labeled)} =`);
      const L = (k: string, v: number) => { if (Math.abs(v) > 0.005) console.log(`    ${k.padEnd(34)} ${inr(v)}`); };
      L("carried: card bill", carriedOnCard); L("carried: others on your budget", carriedOthers); L("carried: free → Piggy", carriedFreeHeld);
      L("sinking funds", group.sinkingHeld); L("general Piggy", piggyAmt); L("Piggy to hand over", group.pendingPiggyHeld);
      if (incRecv) for (const c of group.cats) L(`budget left: ${c.name}`, c.remaining);
      L("set-asides", earmarked); L("to give treasurer (pending)", give);
      if (incRecv && group.selfFundsBills) { for (const b of shownBills) L(`held bill: ${b.name}`, b.amount); for (const b of (group.pendingCardBills ?? []).filter((x) => !x.done)) L(`held card bill`, b.familyAmount); }
      L("to forward (routing)", routing[id] ?? 0); L("family month balance", monthBal); L("allowances kept", keptTotal);
      for (const sp of spentLines) L(`− spent (not own budget): ${sp.name}`, -sp.amount);
      console.log(`  ⇒ REMAINDER (Fronted / own money) ${inr(remainder)}   selfFundsBills=${group.selfFundsBills} unpaidBills=${group.unpaidBills.length} hidden=${group.unpaidBills.filter((b) => b.hidden).length}`);
      // ── NEW coverage model (mirrors InHandPersonGroup v3) ──
      {
        const today = ist.year === period.year && ist.month === period.month ? ist.day : null;
        const { queue, incoming } = memberFlows(plan.steps, id, inHand.treasurerId, today, 0);
        const ck = (b: { cardId: number; cycleEndISO: string }) => `cardbill-${b.cardId}-${b.cycleEndISO}`;
        const held = group.selfFundsBills ? incRecv : !incoming.some((i) => !i.income && !i.billLinked);
        const dueCards = (group.pendingCardBills ?? []).filter((b) => !b.done && (held || (group.selfFundsBills && b.familyMisc <= 0.005)));
        const heldKeys = new Set(dueCards.map(ck));
        const unb = (group.cardUnbilled ?? []).map((u) => held ? { ...u, amount: u.amount + u.oopAmount } : u).filter((u) => u.amount > 0.005);
        const cardTotal = dueCards.reduce((t, b) => t + b.familyAmount, 0) + unb.reduce((t, u) => t + u.amount, 0);
        const fixed = carriedOthers + carriedFreeHeld + group.sinkingHeld + piggyAmt + group.pendingPiggyHeld + (incRecv ? budgetsTotal + group.earmarkedTotal : 0) + cardTotal + (routing[id] ?? 0) + monthBal + keptTotal;
        const q = queue.filter((it) => !(it.cardBill && heldKeys.has(ck(it.cardBill))));
        const { items, unassigned } = allocate(holdingNow + subtractedTotal, fixed, q, incoming);
        console.log(`  NEW ▸ fixed ${inr(fixed)} (cards ${inr(cardTotal)}: ${[...dueCards.map((b) => `${b.cardName} due ${inr(b.familyAmount)}`), ...unb.map((u) => `${u.cardName} next ${inr(u.amount)}`)].join(", ") || "—"})`);
        for (const it of items) console.log(`    ${it.covered ? "✓ held " : "… wait "} ${it.type} ${it.label}${it.toName ? " → " + it.toName : ""} ${inr(it.amount)} day ${it.day ?? "-"}${!it.covered ? `  short ${inr(it.short)}${it.dueNow ? " DUE" : ""} · ${it.arrives ? `${inr(it.arrives.amount)} arrives ${it.arrives.day}` : it.partial ? `${inr(it.partial.amount)} arrives ${it.partial.day} · still short ${inr(it.partial.stillShort)}` : "nothing incoming"}` : ""}`);
        console.log(`    incoming: ${incoming.map((i) => `${i.label} ${inr(i.amount)} d${i.day}`).join(", ") || "—"}`);
        console.log(`    unassigned ${inr(unassigned)} · misc −${inr(subtractedTotal)} ⇒ check: fixed+covered−misc+unassigned = ${inr(fixed + items.filter((i) => i.covered).reduce((t, i) => t + i.amount, 0) - subtractedTotal + unassigned)} vs holding ${inr(holdingNow)}`);
      }
      if (!incRecv && (budgetsTotal || group.earmarkedTotal || toTre[id] || heldBillsTotal)) console.log(`    (not counted until income step is ticked: budgets ${inr(budgetsTotal)}, set-asides ${inr(group.earmarkedTotal)}, to give ${inr(toTre[id] ?? 0)}, bills ${inr(heldBillsTotal)})`);
    }
    console.log(`\n(open=${open}; ownerChargeActive=${ownerChargeActive})`);
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
