// Indian-rupee formatting used across the dashboard.
const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

export function formatINR(amount: number): string {
  return inr.format(amount);
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
