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

  // seed the starter categories so the recurring picker has options
  await seedPersonalCategories(member.id);
  const categories = await prisma.personalCategory.findMany({
    where: { memberId: member.id, archived: false },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true, icon: true },
  });

  return (
    <main className="min-h-screen bg-[#faf9f6]">
      <PersonalOnboarding categories={categories} hasPin={!!member.personalPinHash} />
    </main>
  );
}
