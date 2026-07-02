-- App-lock: one shared household PIN + brute-force ladder.
ALTER TABLE "Household" ADD COLUMN "pinHash" TEXT;
ALTER TABLE "Household" ADD COLUMN "pinSalt" TEXT;
ALTER TABLE "Household" ADD COLUMN "pinFailedAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Household" ADD COLUMN "pinLockedUntil" TIMESTAMP(3);

-- Per-member, per-device biometric credentials (WebAuthn platform authenticators).
CREATE TABLE "WebAuthnCredential" (
    "id" SERIAL NOT NULL,
    "memberId" INTEGER NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" BYTEA NOT NULL,
    "counter" INTEGER NOT NULL DEFAULT 0,
    "transports" TEXT,
    "deviceLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WebAuthnCredential_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WebAuthnCredential_credentialId_key" ON "WebAuthnCredential"("credentialId");

ALTER TABLE "WebAuthnCredential" ADD CONSTRAINT "WebAuthnCredential_memberId_fkey"
    FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
