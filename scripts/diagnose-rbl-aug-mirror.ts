/**
 * READ-ONLY (you run this): pinpoints exactly what makes the RBL Oct-3 bill = ₹9,804, so we can drop it
 * to ₹6,417 (September only) by removing JUST the August mirror line — and proves nothing else moves.
 *
 * It prints, for the RBL credit card:
 *   1. the card + statement/due config,
 *   2. the current UNPAID family cycle (the one due ~Oct 3), every family/peer mirror line in it, split
 *      into AUGUST (to remove) vs SEPTEMBER (to keep), with the AccountTransaction id + linked Spend id,
 *   3. the linked family Spend for each August line (period + status + cardAccountId) — the rows a fix
 *      would touch,
 *   4. the projected bill after removing the August mirror(s),
 *   5. a "no change in hand" proof: the current OPEN period, and that this bill's due date falls AFTER
 *      the open month ends (so it isn't in the open month's In-Hand held-for-bill at all).
 *
 * Run: node_modules/.bin/tsx scripts/diagnose-rbl-aug-mirror.ts
 * (optional) match a different card name:  node_modules/.bin/tsx scripts/diagnose-rbl-aug-mirror.ts "RBL"
 */
import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(__dirname, "..", ".env.local") });
config({ path: resolve(__dirname, "..", ".env") });

const url = process.env.DATABASE_URL ?? "";
if (!url || !/^postgres/i.test(url)) { console.error("✗ DATABASE_URL missing/invalid. Run: vercel env pull .env.local"); process.exit(1); }
const CARD_NEEDLE = (process.argv[2] ?? "rbl").toLowerCase();
const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const d2 = (d: Date) => `${String(d.getDate()).padStart(2, "0")} ${MON[d.getMonth()]} ${d.getFullYear()}`;

// Replicates cash.ts::currentCycle for a statementDay-based 16th→15th style cycle: a spend on/before the
// statement day bills in that month's cycle; after it, next month's. Due = cycle end + dueOffsetDays.
function cycleFor(statementDay: number, date: Date, dueOffset: number | null) {
  const y = date.getFullYear();
  const m = date.getMonth();
  const clampDay = (yy: number, mm: number) => Math.min(statementDay, new Date(yy, mm + 1, 0).getDate());
  let endY = y, endM = m;
  if (date.getDate() > statementDay) { endM = m + 1; if (endM > 11) { endM = 0; endY = y + 1; } }
  const end = new Date(endY, endM, clampDay(endY, endM));
  const due = dueOffset != null ? new Date(end.getFullYear(), end.getMonth(), end.getDate() + dueOffset) : null;
  return { end, due };
}

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const cards = await prisma.financeAccount.findMany({
      where: { type: "credit_card", name: { contains: CARD_NEEDLE, mode: "insensitive" } },
      include: { credit: true, member: { select: { id: true, name: true, householdId: true } } },
    });
    if (cards.length === 0) { console.error(`✗ No credit card whose name contains "${CARD_NEEDLE}".`); return; }
    if (cards.length > 1) console.log(`Multiple cards match — showing all:\n`);

    // household budgeted (tracked, non-Misc) category names → to label a mirror line budgeted vs misc
    const hhIds = [...new Set(cards.map((c) => c.member.householdId))];
    const budgetedCats = await prisma.category.findMany({ where: { householdId: { in: hhIds }, tracked: true, section: { not: "Misc" } }, select: { name: true } });
    const budgetedNames = new Set(budgetedCats.map((c) => c.name));

    for (const card of cards) {
      const sd = card.credit?.statementDay ?? null;
      const off = card.credit?.dueOffsetDays ?? null;
      console.log(`\n============================================================`);
      console.log(`Card #${card.id} "${card.name}"  ·  owner: ${card.member.name}`);
      console.log(`statementDay=${sd ?? "—"}  dueOffsetDays=${off ?? "—"}`);
      if (sd == null) { console.log("  (no statement day → cannot derive cycles)"); continue; }

      // Family/peer mirror lines on this card (this is what feeds the bill's family portion).
      const mirrors = await prisma.accountTransaction.findMany({
        where: { accountId: card.id, source: { in: ["family", "peer"] }, type: "spend" },
        select: { id: true, date: true, amount: true, merchant: true, category: true, source: true, familySpendId: true, personalSpendId: true },
        orderBy: { date: "asc" },
      });
      // Which cycles are already settled (PersonalCardBill exists) → skip those.
      const bills = await prisma.personalCardBill.findMany({ where: { cardAccountId: card.id }, select: { cycleEnd: true, amount: true } });
      const paidKeys = new Set(bills.map((b) => new Date(b.cycleEnd.getFullYear(), b.cycleEnd.getMonth(), b.cycleEnd.getDate()).getTime()));

      // Group mirror lines by cycle end.
      type Line = { id: number; date: Date; amount: number; merchant: string; category: string | null; budgeted: boolean; familySpendId: number | null };
      const byCycle = new Map<number, { end: Date; due: Date | null; lines: Line[] }>();
      for (const t of mirrors) {
        const { end, due } = cycleFor(sd, t.date, off);
        const key = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
        const g = byCycle.get(key) ?? { end, due, lines: [] };
        g.lines.push({ id: t.id, date: t.date, amount: t.amount, merchant: t.merchant, category: t.category, budgeted: t.category != null && budgetedNames.has(t.category), familySpendId: t.familySpendId });
        byCycle.set(key, g);
      }

      const unpaidCycles = [...byCycle.entries()].filter(([k]) => !paidKeys.has(k)).sort((a, b) => a[0] - b[0]);
      if (unpaidCycles.length === 0) { console.log("  No unpaid family cycles on this card."); continue; }

      for (const [, cyc] of unpaidCycles) {
        const total = cyc.lines.reduce((s, l) => s + l.amount, 0);
        console.log(`\n  ── Cycle ending ${d2(cyc.end)}  ·  due ${cyc.due ? d2(cyc.due) : "—"}  ·  family total ${inr(total)}`);
        // split by the spend's calendar month (the Aug vs Sep split)
        const byMonth = new Map<string, Line[]>();
        for (const l of cyc.lines) {
          const mk = `${l.date.getFullYear()}-${l.date.getMonth()}`;
          (byMonth.get(mk) ?? byMonth.set(mk, []).get(mk)!).push(l);
        }
        for (const [mk, lines] of [...byMonth.entries()].sort()) {
          const [yy, mm] = mk.split("-").map(Number);
          const sub = lines.reduce((s, l) => s + l.amount, 0);
          console.log(`     ${MON[mm]} ${yy}  subtotal ${inr(sub)}   ${lines.length} line(s)`);
          for (const l of lines) {
            console.log(`        AT#${l.id}  ${d2(l.date)}  ${inr(l.amount)}  [${l.budgeted ? "budgeted" : "MISC"}]  cat="${l.category ?? "—"}"  "${l.merchant}"  → Spend#${l.familySpendId ?? "—"}`);
          }
        }
      }

      // For the earliest unpaid cycle (the one due next), resolve the AUGUST lines' linked family Spend.
      const target = unpaidCycles[0][1];
      const augLines = target.lines.filter((l) => l.date.getMonth() === 7); // 7 = August
      const sepLines = target.lines.filter((l) => l.date.getMonth() === 8); // 8 = September
      const augTotal = augLines.reduce((s, l) => s + l.amount, 0);
      const sepTotal = sepLines.reduce((s, l) => s + l.amount, 0);
      console.log(`\n  ▶ THIS BILL (cycle ${d2(target.end)}, due ${target.due ? d2(target.due) : "—"}):`);
      console.log(`      August portion (to REMOVE):  ${inr(augTotal)}  in ${augLines.length} mirror line(s)`);
      console.log(`      September portion (to KEEP):  ${inr(sepTotal)}`);
      console.log(`      Current bill: ${inr(augTotal + sepTotal)}   →   After removing August: ${inr(sepTotal)}`);

      if (augLines.length) {
        console.log(`\n  ▶ Rows a fix would touch (August mirror + its linked Spend):`);
        for (const l of augLines) {
          console.log(`      • DELETE  AccountTransaction #${l.id}  (${inr(l.amount)}, ${d2(l.date)}, "${l.merchant}")`);
          if (l.familySpendId != null) {
            const sp = await prisma.spend.findUnique({
              where: { id: l.familySpendId },
              include: { period: { select: { label: true, status: true } }, category: { select: { name: true } }, member: { select: { name: true } } },
            });
            if (sp) console.log(`          linked Spend #${sp.id}: ${inr(sp.amount)} · cat="${sp.category.name}" · ${sp.member?.name ?? "—"} · period ${sp.period.label} [${sp.period.status}] · cardAccountId=${sp.cardAccountId ?? "null"}`);
          }
        }
      }
    }

    // "No change in hand" proof: the open period + whether this bill is even in its In-Hand window.
    const hh = hhIds[0];
    const open = await prisma.period.findFirst({ where: { householdId: hh, status: "open" }, select: { year: true, month: true, label: true } });
    console.log(`\n============================================================`);
    console.log(`NO-CHANGE-IN-HAND PROOF`);
    if (open) {
      const monthEnd = new Date(open.year, open.month, 0);
      console.log(`  Open month: ${open.label}  (ends ${d2(monthEnd)})`);
      console.log(`  In-Hand's "held for the bill" only counts card bills DUE within the open month`);
      console.log(`  (queries.ts:1016). This RBL bill is due in OCTOBER, i.e. AFTER ${d2(monthEnd)},`);
      console.log(`  so it is NOT in ${open.label}'s In-Hand today → removing the August mirror cannot`);
      console.log(`  change the In-Hand you see now. It only lowers the bill (and October's held-for-bill`);
      console.log(`  line) from ${inr(9804)}-ish to the September-only amount.`);
    } else {
      console.log(`  (no open period found)`);
    }
    console.log(`\nNothing was written. Review the rows above, then I'll prepare the one-off fix.`);
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
