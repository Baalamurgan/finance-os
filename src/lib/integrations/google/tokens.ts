import { prisma } from "@/lib/prisma";
import { encrypt, decrypt } from "@/lib/crypto";
import { refreshAccessToken, revokeToken, type GoogleGrant } from "./oauth";

// Vault access for the member's single Google grant. Scopes accumulate (incremental
// consent); the refresh token is the durable secret. Access tokens are cached encrypted
// and re-minted on demand. All secret writes go through @/lib/crypto (AES-256-GCM).

const PROVIDER = "google";
const SKEW_MS = 60_000; // refresh a bit before actual expiry

function mergeScopes(existing: string | null, incoming: string[]): string {
  const set = new Set([...(existing ?? "").split(" ").filter(Boolean), ...incoming]);
  return [...set].join(" ");
}

/** Store (or update) the member's Google grant after an OAuth exchange. */
export async function saveGoogleGrant(memberId: number, grant: GoogleGrant): Promise<void> {
  const existing = await prisma.integration.findUnique({ where: { memberId_provider: { memberId, provider: PROVIDER } } });
  const scopes = mergeScopes(existing?.scopes ?? null, grant.scopes);
  const data = {
    kind: "oauth",
    scopes,
    status: "connected",
    accessTokenEnc: grant.accessToken ? encrypt(grant.accessToken) : existing?.accessTokenEnc ?? null,
    accessExpiresAt: grant.expiryDate ? new Date(grant.expiryDate) : existing?.accessExpiresAt ?? null,
    // Google only returns a refresh token on fresh consent — keep the old one if absent.
    refreshTokenEnc: grant.refreshToken ? encrypt(grant.refreshToken) : existing?.refreshTokenEnc ?? null,
    meta: { email: grant.email ?? (existing?.meta as { email?: string } | null)?.email ?? null },
  };
  await prisma.integration.upsert({
    where: { memberId_provider: { memberId, provider: PROVIDER } },
    create: { memberId, provider: PROVIDER, ...data },
    update: data,
  });
}

/** The scopes we currently hold for this member's Google account (plaintext, not secret). */
export async function googleConnectedScopes(memberId: number): Promise<string[]> {
  const row = await prisma.integration.findUnique({
    where: { memberId_provider: { memberId, provider: PROVIDER } },
    select: { scopes: true, status: true },
  });
  if (!row || row.status !== "connected") return [];
  return (row.scopes ?? "").split(" ").filter(Boolean);
}

/** A valid access token for server-side Google API calls, refreshing if the cache is stale.
 *  Returns null when the member has no usable Google grant. */
export async function getGoogleAccessToken(memberId: number): Promise<string | null> {
  const row = await prisma.integration.findUnique({ where: { memberId_provider: { memberId, provider: PROVIDER } } });
  if (!row || row.status !== "connected" || !row.refreshTokenEnc) return null;

  if (row.accessTokenEnc && row.accessExpiresAt && row.accessExpiresAt.getTime() - SKEW_MS > Date.now()) {
    return decrypt(row.accessTokenEnc);
  }
  try {
    const { accessToken, expiryDate } = await refreshAccessToken(decrypt(row.refreshTokenEnc));
    await prisma.integration.update({
      where: { id: row.id },
      data: { accessTokenEnc: encrypt(accessToken), accessExpiresAt: expiryDate ? new Date(expiryDate) : null },
    });
    return accessToken;
  } catch {
    await prisma.integration.update({ where: { id: row.id }, data: { status: "error" } });
    return null;
  }
}

/** Soft-disconnect one scope: stop using it. If it was the last scope, fully revoke. */
export async function disconnectGoogleScope(memberId: number, scope: string): Promise<void> {
  const row = await prisma.integration.findUnique({ where: { memberId_provider: { memberId, provider: PROVIDER } } });
  if (!row) return;
  const remaining = (row.scopes ?? "").split(" ").filter(Boolean).filter((s) => s !== scope);
  if (remaining.length === 0) {
    await revokeGoogle(memberId);
    return;
  }
  await prisma.integration.update({ where: { id: row.id }, data: { scopes: remaining.join(" ") } });
}

/** Fully revoke Google access at Google's end and drop the vault row. */
export async function revokeGoogle(memberId: number): Promise<void> {
  const row = await prisma.integration.findUnique({ where: { memberId_provider: { memberId, provider: PROVIDER } } });
  if (!row) return;
  const token = row.refreshTokenEnc ? decrypt(row.refreshTokenEnc) : null;
  if (token) {
    try {
      await revokeToken(token);
    } catch {
      /* best-effort — still drop our copy below */
    }
  }
  await prisma.integration.delete({ where: { id: row.id } });
}
