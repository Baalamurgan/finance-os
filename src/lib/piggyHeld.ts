// Last month's FREE budget leftover that swept into the general Piggy still sits inside a member's
// opening carry. The In-Hand "Held for" list used to label that one rupee twice:
//   • non-holder (owner): "Free → Piggy · carried" (swept) AND "Piggy to hand over" (pendingPiggyHeld);
//   • Piggy holder: "Free → Piggy · carried" (swept) AND "General Piggy" (the balance he holds, which
//     already contains his own swept slice).
// This returns the figures so each rupee is shown/counted once.
export function piggyHeldParts(p: {
  swept: number; // Σ positive free leftover that went to the Piggy last month
  pendingPiggyHeld: number; // slice this owner still holds, pending hand-over to the holder
  isHolder: boolean;
  piggyGone: boolean; // handed over (owner) / forwarded (holder) → the cash has left
}): {
  /** subtract `swept` from holding-now (it left the carry: gone, or now counted in the holder's Piggy balance) */
  sweptOut: boolean;
  /** the "Free → Piggy · carried" amount to LIST (the part not already shown on another Piggy line) */
  carriedFreeHeld: number;
} {
  const { swept, pendingPiggyHeld, isHolder, piggyGone } = p;
  const sweptOut = isHolder || piggyGone;
  const carriedFreeHeld = isHolder || piggyGone ? 0 : Math.max(0, Math.round((swept - pendingPiggyHeld) * 100) / 100);
  return { sweptOut, carriedFreeHeld };
}

// Last month's Piggy leftover is physically HELD by the category owners until they hand it to the Piggy
// holder (the "pending lump"). If some of the Piggy is then TAKEN AS INCOME for the new month, that cash is
// drawn against the pending lump first whenever the remaining Piggy balance doesn't cover it — and then it
// never passes through the holder: the OWNER hands it straight to the treasurer. This splits each owner's
// slice into "still to the holder" and "consumed as income → treasurer", so the holder's General Piggy
// (balance − lump still owed to them) can't go negative and no owner → holder → treasurer chain is made.
export function splitPiggyLump(p: {
  slices: Map<number, number>; // owner → their held slice of last month's leftover
  handedOver: boolean; // the owners already handed the lump to the holder
  piggyBalance: number; // general Piggy balance NOW (after any withdrawals)
  incomeAll: number; // Σ "From Piggy" income taken this month (handed or not)
  incomeOpen: number; // the part not yet received by the treasurer
}): {
  toHolder: Map<number, number>; // per owner: still to hand to the holder
  toPool: Map<number, number>; // per owner: consumed as income and still in their hands (→ treasurer)
  held: Map<number, number>; // per owner: physically held now (toHolder + toPool)
  lumpToHolder: number; // Σ toHolder — what the holder is still owed
  consumed: number; // total of the lump consumed by income
} {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const toHolder = new Map<number, number>();
  const toPool = new Map<number, number>();
  const held = new Map<number, number>();
  const total = p.handedOver ? 0 : r2([...p.slices.values()].reduce((t, v) => t + v, 0));
  const consumed = total > 0.005 ? r2(Math.min(total, p.incomeAll, Math.max(0, total - p.piggyBalance))) : 0;
  const consumedOpen = r2(Math.min(consumed, p.incomeOpen)); // not yet received by the treasurer → still in owners' hands
  const share = (v: number, part: number) => (total > 0.005 ? r2((part * v) / total) : 0);
  for (const [o, v] of p.slices) {
    if (p.handedOver) { toHolder.set(o, 0); continue; }
    toHolder.set(o, r2(v - share(v, consumed)));
    const pool = share(v, consumedOpen);
    if (pool > 0.005) toPool.set(o, pool);
    const h = r2((toHolder.get(o) ?? 0) + pool);
    if (h > 0.005) held.set(o, h);
  }
  return { toHolder, toPool, held, lumpToHolder: r2([...toHolder.values()].reduce((t, v) => t + v, 0)), consumed };
}
