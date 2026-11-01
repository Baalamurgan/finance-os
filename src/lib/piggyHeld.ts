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
