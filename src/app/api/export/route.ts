// Per-month CSV export (data safety / portability). Any signed-in member can export.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

function csvCell(v: unknown) {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function row(cells: unknown[]) {
  return cells.map(csvCell).join(",");
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.memberId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const year = Number(url.searchParams.get("y"));
  const month = Number(url.searchParams.get("m"));
  if (!year || !month) return NextResponse.json({ error: "missing y/m" }, { status: 400 });

  const period = await prisma.period.findFirst({ where: { year, month } });
  if (!period) return NextResponse.json({ error: "no data for that month" }, { status: 404 });

  const [incomes, expenses, spends, members, categories] = await Promise.all([
    prisma.incomeEntry.findMany({ where: { periodId: period.id } }),
    prisma.expenseEntry.findMany({ where: { periodId: period.id } }),
    prisma.spend.findMany({ where: { periodId: period.id } }),
    prisma.member.findMany({ where: { householdId: period.householdId } }),
    prisma.category.findMany({ where: { householdId: period.householdId } }),
  ]);
  const mName = (id: number | null) => (id == null ? "" : members.find((x) => x.id === id)?.name ?? "");
  const cName = (id: number | null) => (id == null ? "" : categories.find((x) => x.id === id)?.name ?? "");

  const lines: string[] = [];
  lines.push(row(["Section", "Label", "Category", "Member", "Amount"]));
  for (const i of incomes) lines.push(row(["Income", i.source, "", mName(i.ownerId), i.amount]));
  for (const e of expenses) lines.push(row(["Expense", e.label, cName(e.categoryId), mName(e.memberId), e.amount]));
  for (const s of spends) lines.push(row(["Spend", s.label, cName(s.categoryId), mName(s.memberId), s.amount]));
  const totalInc = incomes.reduce((a, b) => a + b.amount, 0);
  const totalExp = expenses.reduce((a, b) => a + b.amount, 0);
  lines.push(row([]));
  lines.push(row(["Total income", "", "", "", totalInc]));
  lines.push(row(["Total expense", "", "", "", totalExp]));
  lines.push(row(["Balance", "", "", "", totalInc - totalExp]));
  lines.push(row(["Carried in", "", "", "", period.carryForward]));

  const csv = lines.join("\n");
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${period.label.replace(/\s+/g, "_")}.csv"`,
    },
  });
}
