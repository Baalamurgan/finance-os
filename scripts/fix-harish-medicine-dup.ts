// GUIDED ONE-OFF FIX (run manually, against PROD). Deletes Harish's DOUBLE entry "Baala medicine" (₹86,
// 13 Oct, Health). A month settles the PREVIOUS month's daily spends, so this October spend sits in
// NOVEMBER's settlement as an out-of-pocket Personal/Misc credit; deleting it drops that line, so
// November's budget goes up by ₹86.
//
// RUN from the repo root:
//   export DATABASE_URL=$(grep '^DIRECT_URL=' .env.local.prod-backup | cut -d= -f2- | tr -d '"')
//   npx tsx scripts/fix-harish-medicine-dup.ts            # dry run: lists matches, deletes nothing
//   npx tsx scripts/fix-harish-medicine-dup.ts --apply    # deletes, only if EXACTLY ONE match
//
// GUARDED: matches Spend by label ~ "baala medicine", amount ₹86, member Harish, date 13 Oct. Zero or
// several matches → aborts. Prints the November settlement before/after. Delete this file once run.
import { prisma } from "@/lib/prisma";
import { _getSettlement } from "@/lib/queries";

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const apply = process.argv.includes("--apply");

async function main() {
  const h = await prisma.household.findFirst({ select: { id: true, treasurerMemberId: true } });
  if (!h) return console.log("no household");
  const members = await prisma.member.findMany({ where: { householdId: h.id }, select: { id: true, name: true, role: true } });
  const harish = members.find((m) => m.name.toLowerCase().includes("harish"));
  if (!harish) return console.log("Harish not found");

  const cands = await prisma.spend.findMany({
    where: { memberId: harish.id, label: { contains: "baala medicine", mode: "insensitive" }, amount: { gte: 85.5, lte: 86.5 } },
    include: { category: { select: { name: true } } },
  });
  const matches = cands.filter((s) => s.createdAt.getUTCMonth() === 9 && [12, 13].includes(s.createdAt.getUTCDate())); // 13 Oct (IST/UTC tolerant)
  console.log(`Candidates for Harish / "Baala medicine" / ₹86:`);
  for (const s of cands) console.log("  ", JSON.stringify({ id: s.id, label: s.label, amount: s.amount, createdAt: s.createdAt, category: s.category?.name, periodId: s.periodId }));
  if (matches.length !== 1) { console.error(`GUARD: expected exactly 1 match on 13 Oct, found ${matches.length}. Nothing changed.`); return; }
  const sp = matches[0];

  const nov = await prisma.period.findFirst({ where: { householdId: h.id, status: "open" }, orderBy: [{ year: "desc" }, { month: "desc" }] });
  if (!nov) return console.log("no open month");
  const treasurerId = nov.treasurerMemberId ?? h.treasurerMemberId ?? members.find((m) => m.role === "head")?.id ?? null;
  const before = await _getSettlement(h.id, nov.id, treasurerId);
  const hb = before.rows.find((r) => r.id === harish.id)!;
  console.log(`BEFORE — Harish: paid ${inr(hb.paid)} · net ${inr(hb.net)}`);

  if (!apply) { console.log(`DRY RUN — would delete Spend #${sp.id}. Re-run with --apply.`); return; }
  await prisma.spend.delete({ where: { id: sp.id } });
  console.log(`DELETED Spend #${sp.id} ✓`);
  const after = await _getSettlement(h.id, nov.id, treasurerId);
  const ha = after.rows.find((r) => r.id === harish.id)!;
  console.log(`AFTER  — Harish: paid ${inr(ha.paid)} · net ${inr(ha.net)} (Δ net ${inr(ha.net - hb.net)})`);
}
main().finally(() => prisma.$disconnect());
