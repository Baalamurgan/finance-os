-- Personal OS: per-member integration vault (Google OAuth tokens, AI provider keys).
-- All secret columns are AES-256-GCM encrypted at the application layer.
CREATE TABLE "Integration" (
  "id"              SERIAL PRIMARY KEY,
  "memberId"        INTEGER NOT NULL REFERENCES "Member"("id") ON DELETE CASCADE,
  "provider"        TEXT NOT NULL,
  "kind"            TEXT NOT NULL DEFAULT 'oauth',
  "refreshTokenEnc" TEXT,
  "accessTokenEnc"  TEXT,
  "accessExpiresAt" TIMESTAMP(3),
  "scopes"          TEXT,
  "apiKeyEnc"       TEXT,
  "meta"            JSONB,
  "status"          TEXT NOT NULL DEFAULT 'connected',
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX "Integration_memberId_provider_key" ON "Integration"("memberId", "provider");
CREATE INDEX "Integration_memberId_idx" ON "Integration"("memberId");
