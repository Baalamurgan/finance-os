// Per-category overspend carry (user-chosen model): when a month's total budget overspend exceeds
// its sheet surplus, the surplus absorbs the overspend FIRST, and only the NET shortfall is charged
// to next month — by shrinking the overspent categories' budgets, allocated proportionally to how
// much each one overspent. Pure + unit-tested; the DB side (applyBudgetShortfall) just feeds it.
export function budgetShortfallReductions(input: {
  surplus: number; // source month's pre-overspend sheet balance = carryForward + income − expense
  overspendByCat: Record<number, number>; // categoryId → overspend (spent − budget, only if > 0)
}): { netShortfall: number; reductionByCat: Record<number, number> } {
  const entries = Object.entries(input.overspendByCat).filter(([, v]) => v > 0.005);
  const totalOver = entries.reduce((s, [, v]) => s + v, 0);
  // The surplus (may be negative if an earlier shortfall was carried in) absorbs the overspend;
  // only what's left over is pushed to the categories.
  const netShortfall = Math.max(0, Math.round((totalOver - input.surplus) * 100) / 100);
  const reductionByCat: Record<number, number> = {};
  if (netShortfall > 0.005 && totalOver > 0) {
    for (const [id, v] of entries) {
      reductionByCat[Number(id)] = Math.round(netShortfall * (v / totalOver) * 100) / 100;
    }
  }
  return { netShortfall, reductionByCat };
}
