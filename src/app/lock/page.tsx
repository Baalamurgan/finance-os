import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getHousehold } from "@/lib/queries";
import { isUnlocked, setUnlockCookie } from "@/lib/applock";
import { LockScreen } from "@/components/LockScreen";

export const metadata = { title: "Locked · Family Finance OS" };

export default async function LockPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const household = await getHousehold();
  if (!household) redirect("/signin");

  // no PIN set, or already unlocked → nothing to do here
  if (!household.pinHash) {
    await setUnlockCookie(household.id);
    redirect("/");
  }
  if (await isUnlocked(household.id)) redirect("/");

  const memberId = session.user.memberId;
  const hasBiometric = memberId
    ? (await prisma.webAuthnCredential.count({ where: { memberId } })) > 0
    : false;

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#faf9f6] px-6 py-10">
      <LockScreen
        householdName={household.name}
        greetingName={session.user.memberName ?? session.user.name ?? null}
        hasBiometric={hasBiometric}
      />
    </main>
  );
}
