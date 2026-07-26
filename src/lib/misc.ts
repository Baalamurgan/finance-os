// Shared spend-kind list, dependency-free so it's safe to import from both client and
// server code. It's the SINGLE source of the personal-view categories AND the family
// "Personal/Misc" sub-category tags — same kinds everywhere.
// the 50/30/20 default bucket (need | want | invest) — reclassifiable in personal Setup.
export const CATEGORY_KINDS: { name: string; icon: string; bucket: string }[] = [
  { name: "Food & Dining", icon: "🍽️", bucket: "want" },
  { name: "Groceries", icon: "🛒", bucket: "need" },
  { name: "Shopping", icon: "🛍️", bucket: "want" },
  { name: "Bills & Utilities", icon: "🧾", bucket: "need" },
  { name: "Rent", icon: "🏠", bucket: "need" },
  { name: "Transport & Fuel", icon: "🚕", bucket: "need" },
  { name: "Entertainment", icon: "🎬", bucket: "want" },
  { name: "Travel", icon: "✈️", bucket: "want" },
  { name: "Health", icon: "💊", bucket: "need" },
  { name: "Education", icon: "📚", bucket: "need" },
  { name: "Personal Care", icon: "💇", bucket: "want" },
  { name: "Gifts & Donations", icon: "🎁", bucket: "want" },
  { name: "Transfers / Sent", icon: "💸", bucket: "want" },
  { name: "EMI & Loans", icon: "🏦", bucket: "need" },
  { name: "Investments", icon: "📈", bucket: "invest" },
  { name: "Miscellaneous", icon: "🔧", bucket: "want" },
];

/**
 * The sub-category list used to tag family "Personal/Misc" spends — the same kinds as
 * the personal-view categories, so the Analysis breakdown can show where misc money
 * actually goes. Reporting-only; never affects settlement or budgets.
 */
export const MISC_SUBCATEGORIES: { name: string; icon: string }[] = [
  // The main *legitimate* reason a household item lands in Misc: it was bought for
  // someone outside our budget (e.g. petrol for a relative). Listed first so it's the
  // obvious pick, and so the Add-Spend nudge knows this Misc entry was deliberate.
  { name: "For someone else", icon: "👥" },
  ...CATEGORY_KINDS.map(({ name, icon }) => ({ name, icon })),
];

/** Is this the family misc bucket? (the tracked category in the "Misc" section) */
export function isMiscBucket(cat: { section: string; tracked: boolean }): boolean {
  return cat.section === "Misc" && cat.tracked;
}
