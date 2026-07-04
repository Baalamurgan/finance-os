import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { seedPersonalCategories } from "@/lib/personal";
import { PersonalOnboarding } from "@/components/personal/PersonalOnboarding";

export const metadata = { title: "Set up Personal" };

export default async function PersonalOnboardingPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const email = session.user.email?.toLowerCase();
  const member = session.user.memberId
    ? await prisma.member.findUnique({ where: { id: session.user.memberId } })
    : email
      ? await prisma.member.findFirst({ where: { email } })
      : null;
  if (!member) redirect("/signin");
  if (member.personalOnboarded) redirect("/personal");

  // seed the starter spend categories (used later in the Expenses tab)
  await seedPersonalCategories(member.id);

  return (
    <main className="min-h-screen bg-[#faf9f6]">
      <PersonalOnboarding hasPin={!!member.personalPinHash} />
    </main>
  );
}
