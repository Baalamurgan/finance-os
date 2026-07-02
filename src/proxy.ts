import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Next 16 renamed Middleware -> Proxy. This is an *optimistic* check only:
// if there's no Auth.js session cookie, bounce to /signin. Real authorization
// (whitelist, role) happens in server components/actions via auth().
export function proxy(request: NextRequest) {
  const hasSession =
    request.cookies.has("authjs.session-token") ||
    request.cookies.has("__Secure-authjs.session-token");

  if (!hasSession) {
    const url = new URL("/signin", request.url);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // run on everything except auth routes, the public landing page, the sign-in
  // page, and static assets
  matcher: [
    "/((?!api/auth|api/cron|welcome|signin|_next/static|_next/image|favicon.ico|manifest.webmanifest|sw\\.js|.*\\.png).*)",
  ],
};
