import { NextResponse } from "next/server";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { rpConfig } from "@/lib/applock";
import { REG_CHALLENGE, clearChallenge, getChallenge } from "@/lib/webauthn";

export const runtime = "nodejs";

// Finish enrolling this device's biometric and store the credential.
export async function POST(req: Request) {
  const session = await auth();
  const memberId = session?.user?.memberId;
  if (!memberId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const expectedChallenge = await getChallenge(REG_CHALLENGE);
  if (!expectedChallenge) return NextResponse.json({ error: "Challenge expired." }, { status: 400 });

  const body = await req.json();
  const { rpID, origin } = rpConfig();

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
  } catch {
    return NextResponse.json({ verified: false, error: "Could not verify." }, { status: 400 });
  }

  await clearChallenge(REG_CHALLENGE);

  if (!verification.verified || !verification.registrationInfo) {
    return NextResponse.json({ verified: false });
  }

  const { credentialID, credentialPublicKey, counter } = verification.registrationInfo;
  const credentialId = isoBase64URL.fromBuffer(credentialID);
  const label = String(body?.deviceLabel ?? "").slice(0, 40) || "This device";

  await prisma.webAuthnCredential.upsert({
    where: { credentialId },
    update: { counter, memberId },
    create: {
      memberId,
      credentialId,
      publicKey: Buffer.from(credentialPublicKey),
      counter,
      transports: Array.isArray(body?.response?.transports)
        ? body.response.transports.join(",")
        : null,
      deviceLabel: label,
    },
  });

  return NextResponse.json({ verified: true });
}
