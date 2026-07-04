import { NextResponse } from "next/server";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { rpConfig } from "@/lib/applock-core";
import { setPersonalUnlock } from "@/lib/personal-lock";
import { clearChallenge, getChallenge } from "@/lib/webauthn";

export const runtime = "nodejs";
const CHAL = "wa-pauth-chal";

// Biometric unlock for the PERSONAL lock → sets the personal-unlock cookie.
export async function POST(req: Request) {
  const session = await auth();
  const memberId = session?.user?.memberId;
  if (!memberId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const expectedChallenge = await getChallenge(CHAL);
  if (!expectedChallenge) return NextResponse.json({ error: "Challenge expired." }, { status: 400 });

  const body = await req.json();
  const cred = await prisma.webAuthnCredential.findFirst({
    where: { credentialId: body.id, memberId, purpose: "personal" },
  });
  if (!cred) return NextResponse.json({ error: "Unknown credential." }, { status: 400 });

  const { rpID, origin } = rpConfig();
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      authenticator: {
        credentialID: isoBase64URL.toBuffer(cred.credentialId),
        credentialPublicKey: cred.publicKey,
        counter: cred.counter,
        transports: cred.transports ? (cred.transports.split(",") as AuthenticatorTransport[]) : undefined,
      },
      requireUserVerification: true,
    });
  } catch {
    return NextResponse.json({ verified: false, error: "Could not verify." }, { status: 400 });
  }

  await clearChallenge(CHAL);
  if (!verification.verified) return NextResponse.json({ verified: false });

  await prisma.webAuthnCredential.update({
    where: { id: cred.id },
    data: { counter: verification.authenticationInfo.newCounter },
  });
  await setPersonalUnlock(memberId);
  return NextResponse.json({ verified: true });
}
