import { NextResponse } from "next/server";
import { autoCloseElapsedMonths, ensureCurrentMonth } from "@/lib/ensureMonth";
import { revalidateFamily } from "@/lib/revalidate";

// Month-end wind-down cron. Runs at 23:59 IST on the last day of each month (see vercel.json:
// `59 18 28-31 * *` = 18:29 UTC, and autoCloseElapsedMonths only closes the current month when
// it's actually the last IST day at 23:59). Closing promotes the successor month to open; the
// separate ensure-month cron on the 1st stays as a safety net if this run is ever missed.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }
  const closed = await autoCloseElapsedMonths();
  const result = await ensureCurrentMonth();
  // These flip period.status (open/draft/closed), which the cached getInHand/getRollup read — bust the tag.
  revalidateFamily();
  return NextResponse.json({ ok: true, closed, ...result });
}
