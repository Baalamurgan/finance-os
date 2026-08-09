// Indian-rupee formatting used across the dashboard.
const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

export function formatINR(amount: number): string {
  return inr.format(amount);
}

// Format a 0–100 percentage for display, never showing a misleading "0%" for a positive value:
// a share that rounds down to zero (0 < pct < 0.5) reads "<1%". A genuine zero stays "0%".
// For signed rates (which can be negative), don't use this — it clamps to "0%".
export function pctLabel(pct: number): string {
  if (!Number.isFinite(pct) || pct <= 0) return "0%";
  return Math.round(pct) === 0 ? "<1%" : `${Math.round(pct)}%`;
}

// Parse a human-typed rupee amount, tolerating Indian formatting: "1,00,000", "₹5,000",
// spaces, stray commas. Returns NaN for genuinely empty/invalid input so callers keep
// their existing `!amount` / `isNaN` guards. A strict widening of Number() — identical
// for plain numbers, only additionally accepting commas/₹/spaces.
export function parseAmount(v: FormDataEntryValue | string | null | undefined): number {
  const cleaned = String(v ?? "").replace(/[₹,\s]/g, "");
  if (cleaned === "") return NaN;
  return Number(cleaned);
}
