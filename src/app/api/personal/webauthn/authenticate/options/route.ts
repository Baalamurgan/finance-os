import { NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { rpConfig } from "@/lib/applock-core";
import { setChallenge } from "@/lib/webauthn";

export const runtime = "nodejs";
const CHAL = "wa-pauth-chal";

export async function POST() {
  const session = await auth();
  const memberId = session?.user?.memberId;
  if (!memberId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { rpID } = rpConfig();
  const creds = await prisma.webAuthnCredential.findMany({ where: { memberId, purpose: "personal" } });
  if (creds.length === 0) return NextResponse.json({ error: "No biometric set up." }, { status: 400 });

  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: creds.map((c) => ({
      id: isoBase64URL.toBuffer(c.credentialId),
      type: "public-key",
      transports: c.transports ? (c.transports.split(",") as AuthenticatorTransport[]) : undefined,
    })),
    userVerification: "required",
  });

  await setChallenge(CHAL, options.challenge);
  return NextResponse.json(options);
}
