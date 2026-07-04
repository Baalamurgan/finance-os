import { NextResponse } from "next/server";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { rpConfig } from "@/lib/applock-core";
import { clearChallenge, getChallenge } from "@/lib/webauthn";

export const runtime = "nodejs";
const CHAL = "wa-preg-chal";

export async function POST(req: Request) {
  const session = await auth();
  const memberId = session?.user?.memberId;
  if (!memberId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const expectedChallenge = await getChallenge(CHAL);
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

  await clearChallenge(CHAL);
  if (!verification.verified || !verification.registrationInfo) {
    return NextResponse.json({ verified: false });
  }

  const { credentialID, credentialPublicKey, counter } = verification.registrationInfo;
  const credentialId = isoBase64URL.fromBuffer(credentialID);
  await prisma.webAuthnCredential.upsert({
    where: { credentialId },
    update: { counter, memberId, purpose: "personal" },
    create: {
      memberId,
      credentialId,
      publicKey: Buffer.from(credentialPublicKey),
      counter,
      transports: Array.isArray(body?.response?.transports) ? body.response.transports.join(",") : null,
      deviceLabel: String(body?.deviceLabel ?? "").slice(0, 40) || "This device",
      purpose: "personal",
    },
  });

  return NextResponse.json({ verified: true });
}
