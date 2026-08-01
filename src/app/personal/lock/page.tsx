import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isPersonalUnlocked } from "@/lib/personal-lock";
import { PersonalLockScreen } from "@/components/personal/PersonalLockScreen";

export const metadata = { title: "Personal — locked" };

export default async function PersonalLockPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const email = session.user.email?.toLowerCase();
  const member = session.user.memberId
    ? await prisma.member.findUnique({ where: { id: session.user.memberId } })
    : email
      ? await prisma.member.findFirst({ where: { email } })
      : null;
  if (!member) redirect("/signin");
  if (!member.personalOnboarded) redirect("/personal/onboarding");
  if (await isPersonalUnlocked(member.id)) redirect("/personal");

  const hasBiometric =
    (await prisma.webAuthnCredential.count({ where: { memberId: member.id, purpose: "personal" } })) > 0;

  const sp = await searchParams;
  const next = typeof sp?.next === "string" && sp.next.startsWith("/personal") && !sp.next.startsWith("//") ? sp.next : "/personal/today";

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#faf9f6] px-6 py-10">
      <PersonalLockScreen greetingName={session.user.memberName ?? session.user.name ?? null} hasBiometric={hasBiometric} next={next} />
    </main>
  );
}
