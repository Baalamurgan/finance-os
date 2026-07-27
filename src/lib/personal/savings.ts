import { prisma } from "@/lib/prisma";

// The personal savings pot — a private, flat ledger per member. Balance = Σ amount.
// Positive rows are money set aside; negative rows are money pulled back into a month
// (each such withdrawal is paired with a one-off PersonalIncome, posted by the action).
export type PersonalSavings = {
  balance: number;
  history: { id: number; amount: number; note: string | null; periodLabel: string | null; createdAtISO: string }[];
};

export async function getPersonalSavings(memberId: number): Promise<PersonalSavings> {
  const [agg, rows] = await Promise.all([
    prisma.personalSavings.aggregate({ where: { memberId }, _sum: { amount: true } }),
    prisma.personalSavings.findMany({
      where: { memberId },
      orderBy: { id: "desc" },
      take: 40,
      include: { period: { select: { label: true } } },
    }),
  ]);
  return {
    balance: agg._sum.amount ?? 0,
    history: rows.map((r) => ({
      id: r.id,
      amount: r.amount,
      note: r.note,
      periodLabel: r.period?.label ?? null,
      createdAtISO: r.createdAt.toISOString(),
    })),
  };
}
