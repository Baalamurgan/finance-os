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

  const path = request.nextUrl.pathname;
  const isGet = request.method === "GET";

  // Reopen where you left off: launching the app (GET "/") jumps to Personal if that
  // was your last view. The personal PIN still gates it — its unlock is a session
  // cookie, so a fresh launch re-locks Personal and shows its lock screen.
  if (isGet && path === "/" && request.cookies.get("last-view")?.value === "personal") {
    return NextResponse.redirect(new URL("/personal/expenses", request.url));
  }

  const res = NextResponse.next();
  const inPersonal = path.startsWith("/personal") || path.startsWith("/api/personal");

  // Remember the current view (only real page loads, not actions/api) for next launch.
  if (isGet && !path.startsWith("/api")) {
    res.cookies.set("last-view", inPersonal ? "personal" : "family", {
      path: "/",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
    });
  }

  // Personal is only unlocked while you're inside /personal. The moment you touch
  // any family route, drop the personal-unlock cookie — so handing the phone over
  // (family view) can never reach Personal without re-entering the personal PIN.
  if (!inPersonal && request.cookies.has("personal-unlock")) {
    res.cookies.delete("personal-unlock");
  }
  return res;
}

export const config = {
  // run on everything except auth routes, the public landing page, the sign-in
  // page, and static assets
  matcher: [
    "/((?!api/auth|api/cron|welcome|signin|_next/static|_next/image|favicon.ico|manifest.webmanifest|sw\\.js|.*\\.png).*)",
  ],
};
