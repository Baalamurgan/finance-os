"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { disconnectGoogleScope, revokeGoogle } from "@/lib/integrations/google/tokens";
import { GOOGLE_INTEGRATION_BY_KEY, type GoogleIntegrationKey } from "@/lib/integrations/google/catalog";

async function meMemberId(): Promise<number | null> {
  const session = await auth();
  if (!session?.user) return null;
  if (session.user.memberId) return session.user.memberId;
  const email = session.user.email?.toLowerCase();
  if (!email) return null;
  const m = await prisma.member.findFirst({ where: { email }, select: { id: true } });
  return m?.id ?? null;
}

// Stop using one Google integration. If it's the member's last granted scope, this fully
// revokes the Google grant (there's no partial revoke at Google's end).
export async function disconnectGoogleIntegration(formData: FormData) {
  const memberId = await meMemberId();
  if (!memberId) return;
  const def = GOOGLE_INTEGRATION_BY_KEY.get(String(formData.get("key")) as GoogleIntegrationKey);
  if (!def) return;
  await disconnectGoogleScope(memberId, def.scope);
  revalidatePath("/personal/settings/permissions");
}

// Fully revoke the whole Google account grant (all scopes) and drop the vault row.
export async function revokeGoogleAccount() {
  const memberId = await meMemberId();
  if (!memberId) return;
  await revokeGoogle(memberId);
  revalidatePath("/personal/settings/permissions");
}
