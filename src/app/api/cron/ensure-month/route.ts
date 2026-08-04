import { NextResponse } from "next/server";
import { autoCloseElapsedMonths, ensureCurrentMonth } from "@/lib/ensureMonth";

// Vercel Cron hits this on the 1st (see vercel.json). Vercel sends
// `Authorization: Bearer $CRON_SECRET` automatically when CRON_SECRET is set.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }
  // Close any elapsed month first (Aug 1 → wind down July), THEN ensure/promote the current
  // month. Order matters: windDownPeriod promotes the just-ended month's successor to open, and
  // ensureCurrentMonth is then a no-op for it (or creates the current month if none exists yet).
  const closed = await autoCloseElapsedMonths();
  const result = await ensureCurrentMonth();
  return NextResponse.json({ ok: true, closed, ...result });
}
