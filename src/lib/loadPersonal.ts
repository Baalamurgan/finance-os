import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isPersonalUnlocked } from "@/lib/personal-lock";
import { ensurePersonalMonth, personalAnchor } from "@/lib/personal";

export type PersonalCommon = NonNullable<Awaited<ReturnType<typeof loadPersonal>>>;

/**
 * Shared data for every /personal screen. Gates: signed in → onboarded →
 * personal-unlocked. Resolves the member's selected month (auto-creating the
 * current one). Everything is scoped to the session member — private by design.
 */
export async function loadPersonal(params?: { y?: string; m?: string }) {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const email = session.user.email?.toLowerCase();
  const member = session.user.memberId
    ? await prisma.member.findUnique({ where: { id: session.user.memberId } })
    : email
      ? await prisma.member.findFirst({ where: { email } })
      : null;
  if (!member) redirect("/signin?error=AccessDenied");

  const account = {
    name: session.user.name ?? member.name,
    email: session.user.email ?? member.email ?? "",
    image: session.user.image ?? null,
  };

  // gate: onboarding → lock
  if (!member.personalOnboarded) redirect("/personal/onboarding");
  if (!(await isPersonalUnlocked(member.id))) redirect("/personal/lock");

  await ensurePersonalMonth(member.id);

  const periods = await prisma.personalPeriod.findMany({
    where: { memberId: member.id },
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });

  const y = params?.y ? Number(params.y) : undefined;
  const m = params?.m ? Number(params.m) : undefined;
  const now = new Date();
  const anchor = personalAnchor(now, member.personalWindDownDay);
  // Explicit month → that month only (null = show the empty state, no silent
  // fall-back to the latest month). No month → the current cycle.
  const selected =
    y && m
      ? (periods.find((p) => p.year === y && p.month === m) ?? null)
      : (periods.find((p) => p.year === anchor.year && p.month === anchor.month) ?? periods[0] ?? null);

  const categories = await prisma.personalCategory.findMany({
    where: { memberId: member.id, archived: false },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  const hasBiometric =
    (await prisma.webAuthnCredential.count({ where: { memberId: member.id, purpose: "personal" } })) > 0;

  // Active credit cards for the "Paid by card" picker (spend + fixed-line modals).
  const creditCards = (
    await prisma.financeAccount.findMany({
      where: { memberId: member.id, type: "credit_card", active: true },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      select: { id: true, name: true, color: true },
    })
  ).map((a) => ({ id: a.id, name: a.name, color: a.color }));

  return {
    member,
    account,
    periods,
    selected,
    selYear: y ?? selected?.year ?? anchor.year,
    selMonth: m ?? selected?.month ?? anchor.month,
    categories,
    creditCards,
    hasBiometric,
  };
}
