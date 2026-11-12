// Month/year pickers only offer months that have data (a sheet / personal month exists).
// Months are passed around as one number: y*12 + (m-1). Client-safe (no server imports).

export const monthKey = (y: number, m: number) => y * 12 + m - 1;

/** Years that have at least one allowed month, newest first (plus any `extra` years, e.g. the selected one). */
export function yearsWithData(allowed: Set<number>, extra: number[] = []): number[] {
  const ys = new Set<number>(extra);
  for (const k of allowed) ys.add(Math.floor(k / 12));
  return [...ys].sort((a, b) => b - a);
}

/** The month to land on after switching to year `y`: keep `want` if it has data, else the nearest month that does. */
export function monthInYear(allowed: Set<number>, y: number, want: number): number {
  if (allowed.has(monthKey(y, want))) return want;
  let best = want;
  let bestDist = Infinity;
  for (let m = 1; m <= 12; m++) {
    if (!allowed.has(monthKey(y, m))) continue;
    const d = Math.abs(m - want);
    if (d < bestDist) { best = m; bestDist = d; }
  }
  return best;
}
