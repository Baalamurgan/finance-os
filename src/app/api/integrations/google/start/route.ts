import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { auth } from "@/auth";
import { GOOGLE_INTEGRATION_BY_KEY } from "@/lib/integrations/google/catalog";
import { buildAuthUrl, googleOAuthConfigured } from "@/lib/integrations/google/oauth";

// Kick off incremental Google consent for ONE integration (calendar | tasks | contacts).
// Separate from NextAuth login so each scope is opt-in and we capture a refresh token.
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.memberId) return NextResponse.redirect(new URL("/signin", req.url));
  if (!googleOAuthConfigured()) {
    return NextResponse.redirect(new URL("/personal/settings/permissions?err=config", req.url));
  }

  const url = new URL(req.url);
  const key = url.searchParams.get("key") ?? "";
  const def = GOOGLE_INTEGRATION_BY_KEY.get(key as never);
  if (!def) return NextResponse.redirect(new URL("/personal/settings/permissions?err=unknown", req.url));

  const base = process.env.AUTH_URL ?? url.origin;
  const redirectUri = `${base}/api/integrations/google/callback`;
  const nonce = randomBytes(16).toString("hex");

  const authUrl = buildAuthUrl({ redirectUri, scope: def.scope, state: nonce });
  const res = NextResponse.redirect(authUrl);
  // CSRF: echo this nonce back in the callback's `state` and match it to the cookie.
  res.cookies.set("gint_oauth", nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  return res;
}
