import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { exchangeCode } from "@/lib/integrations/google/oauth";
import { saveGoogleGrant } from "@/lib/integrations/google/tokens";

// Google redirects here after consent. Verify CSRF state, exchange the code for tokens,
// and vault the (encrypted) refresh token. Then bounce back to the permissions page.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const dest = (q: string) => NextResponse.redirect(new URL(`/personal/settings/permissions?${q}`, req.url));

  const session = await auth();
  if (!session?.user?.memberId) return NextResponse.redirect(new URL("/signin", req.url));

  const error = url.searchParams.get("error");
  if (error) return clearState(dest("err=denied"));

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = req.headers.get("cookie")?.match(/(?:^|;\s*)gint_oauth=([^;]+)/)?.[1];
  if (!code || !state || !cookieState || state !== cookieState) return clearState(dest("err=state"));

  try {
    const base = process.env.AUTH_URL ?? url.origin;
    const grant = await exchangeCode({ redirectUri: `${base}/api/integrations/google/callback`, code });
    await saveGoogleGrant(session.user.memberId, grant);
    return clearState(dest("ok=1"));
  } catch {
    return clearState(dest("err=exchange"));
  }
}

function clearState(res: NextResponse): NextResponse {
  res.cookies.set("gint_oauth", "", { path: "/", maxAge: 0 });
  return res;
}
