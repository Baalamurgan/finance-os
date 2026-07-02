import { NextResponse } from "next/server";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { rpConfig, setUnlockCookie } from "@/lib/applock";
import { AUTH_CHALLENGE, clearChallenge, getChallenge } from "@/lib/webauthn";

export const runtime = "nodejs";

// Finish a biometric unlock: verify the assertion, then set the unlock cookie.
export async function POST(req: Request) {
  const session = await auth();
  const memberId = session?.user?.memberId;
  if (!memberId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const household = await prisma.household.findFirst();
  if (!household) return NextResponse.json({ error: "No household." }, { status: 400 });

  const expectedChallenge = await getChallenge(AUTH_CHALLENGE);
  if (!expectedChallenge) return NextResponse.json({ error: "Challenge expired." }, { status: 400 });

  const body = await req.json();
  const cred = await prisma.webAuthnCredential.findFirst({
    where: { credentialId: body.id, memberId },
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
        transports: cred.transports
          ? (cred.transports.split(",") as AuthenticatorTransport[])
          : undefined,
      },
      requireUserVerification: true,
    });
  } catch {
    return NextResponse.json({ verified: false, error: "Could not verify." }, { status: 400 });
  }

  await clearChallenge(AUTH_CHALLENGE);

  if (!verification.verified) return NextResponse.json({ verified: false });

  await prisma.webAuthnCredential.update({
    where: { id: cred.id },
    data: { counter: verification.authenticationInfo.newCounter },
  });
  await setUnlockCookie(household.id);
  return NextResponse.json({ verified: true });
}
