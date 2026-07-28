import { OAuth2Client } from "google-auth-library";

// Thin wrapper over google-auth-library for the INTEGRATION oauth flow. This is separate
// from NextAuth login (which is JWT-only and stores no tokens): here we deliberately ask
// for offline access + a fresh consent so Google returns a long-lived refresh token we can
// vault. Reuses the same OAuth client as login (AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET) — the
// integration redirect URI is registered on that same client.

export function googleOAuthConfigured(): boolean {
  return !!(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
}

export function oauthClient(redirectUri: string): OAuth2Client {
  return new OAuth2Client({
    clientId: process.env.AUTH_GOOGLE_ID,
    clientSecret: process.env.AUTH_GOOGLE_SECRET,
    redirectUri,
  });
}

export function buildAuthUrl(opts: { redirectUri: string; scope: string; state: string }): string {
  return oauthClient(opts.redirectUri).generateAuthUrl({
    access_type: "offline", // → refresh token
    prompt: "consent", // force a refresh token even on re-grant of an already-approved scope
    include_granted_scopes: true, // incremental: keep previously granted scopes
    scope: [opts.scope],
    state: opts.state,
  });
}

export type GoogleGrant = {
  refreshToken: string | null;
  accessToken: string | null;
  expiryDate: number | null; // epoch ms
  scopes: string[]; // granted this exchange
  email: string | null;
};

export async function exchangeCode(opts: { redirectUri: string; code: string }): Promise<GoogleGrant> {
  const client = oauthClient(opts.redirectUri);
  const { tokens } = await client.getToken(opts.code);
  let email: string | null = null;
  let scopes = (tokens.scope ?? "").split(" ").filter(Boolean);
  if (tokens.access_token) {
    try {
      const info = await client.getTokenInfo(tokens.access_token);
      email = info.email ?? null;
      if (info.scopes?.length) scopes = info.scopes;
    } catch {
      /* token info is best-effort (email/scope confirmation) */
    }
  }
  return {
    refreshToken: tokens.refresh_token ?? null,
    accessToken: tokens.access_token ?? null,
    expiryDate: tokens.expiry_date ?? null,
    scopes,
    email,
  };
}

/** Mint a fresh access token from a stored refresh token. */
export async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiryDate: number | null }> {
  const client = oauthClient("postmessage"); // redirect not used for refresh
  client.setCredentials({ refresh_token: refreshToken });
  const { token } = await client.getAccessToken();
  if (!token) throw new Error("Google refused to refresh the access token.");
  const expiryDate = client.credentials.expiry_date ?? null;
  return { accessToken: token, expiryDate };
}

/** Revoke a token at Google (kills the whole grant for this user+client). */
export async function revokeToken(token: string): Promise<void> {
  await oauthClient("postmessage").revokeToken(token);
}
