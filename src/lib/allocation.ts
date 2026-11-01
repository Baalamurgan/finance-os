import { prisma } from "@/lib/prisma";

// The month's per-category ALLOCATION, defined in ONE place so the In-Hand, the Piggy sweep (wind-down),
// and the wind-down previews can never disagree about what a category was budgeted — which is exactly how
// the Ayudha-Pooja ₹380 "free → Piggy" drifted from the recorded sweep.
//
// Allocation = the category's Budget row `planned`, OR — for a `miscCard` one-off (a planned event like
// "Ayudha Pooja" that carries its budget as an envelope ExpenseEntry instead of a Budget row) with no
// Budget row — that envelope amount. Mirrors the In-Hand's `plannedByCat` fallback exactly (first envelope
// wins via the planned-is-0 guard). Pure so it's unit-tested directly.
export function buildAllocation(
  budgets: { categoryId: number; planned: number }[],
  miscEnvelopes: { categoryId: number | null; amount: number }[],
): Map<number, number> {
  const m = new Map<number, number>(budgets.map((b) => [b.categoryId, b.planned]));
  for (const e of miscEnvelopes) {
    if (e.categoryId != null && (m.get(e.categoryId) ?? 0) === 0 && e.amount > 0) m.set(e.categoryId, e.amount);
  }
  return m;
}

// The miscCard one-off envelopes for a period (the ExpenseEntry that stands in for a Budget row). Shared by
// every caller so the envelope filter stays identical to the In-Hand's.
export function getMiscCardEnvelopes(householdId: number, periodId: number) {
  return prisma.expenseEntry.findMany({
    where: { periodId, note: null, category: { householdId, tracked: true, miscCard: true } },
    select: { categoryId: true, amount: true },
  });
}
