import { NextResponse } from "next/server";
import { ensureCurrentMonth } from "@/lib/ensureMonth";

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
  const result = await ensureCurrentMonth();
  return NextResponse.json({ ok: true, ...result });
}
