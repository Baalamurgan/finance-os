import { NextResponse } from "next/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { rpConfig } from "@/lib/applock";
import { REG_CHALLENGE, setChallenge } from "@/lib/webauthn";

export const runtime = "nodejs";

// Start enrolling this device's biometric for the signed-in member.
export async function POST() {
  const session = await auth();
  const memberId = session?.user?.memberId;
  if (!memberId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { rpID, rpName } = rpConfig();
  const existing = await prisma.webAuthnCredential.findMany({ where: { memberId } });

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userID: String(memberId),
    userName: session.user.email ?? session.user.memberName ?? `member-${memberId}`,
    userDisplayName: session.user.memberName ?? session.user.name ?? "Member",
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({
      id: isoBase64URL.toBuffer(c.credentialId),
      type: "public-key",
      transports: c.transports ? (c.transports.split(",") as AuthenticatorTransport[]) : undefined,
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "required",
      authenticatorAttachment: "platform", // Face ID / Touch ID / Android biometric
    },
  });

  await setChallenge(REG_CHALLENGE, options.challenge);
  return NextResponse.json(options);
}
