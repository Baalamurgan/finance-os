import { revalidatePath, revalidateTag } from "next/cache";

// Coarse tag covering every cached family read (getInHand / getRollup / getSettlement).
// Over-invalidation is safe (just a recompute); a *missed* invalidation is not — money is
// cross-checked to the rupee — so all family reads share this one tag and every family
// mutation busts it.
export const FAMILY_TAG = "family-data";

// Called at the end of every family write (replaces the bare revalidatePath("/","layout")).
// Busts the cached loaders via the tag AND refreshes the rendered routes.
//
// { expire: 0 } forces IMMEDIATE expiry, not the new stale-while-revalidate default. This is a
// read-your-own-writes app — after a payment the treasurer reloads and must see the fresh number
// to the rupee, never a stale one served while a background recompute runs.
export function revalidateFamily() {
  revalidateTag(FAMILY_TAG, { expire: 0 });
  revalidatePath("/", "layout");
}
