import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isPersonalUnlocked } from "@/lib/personal-lock";
import { ensurePersonalMonth, personalAnchor } from "@/lib/personal";
import { getCardBillReminders } from "@/lib/personal/cash";

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

  // Everything below reads independently → one parallel round instead of a chain of ~8 round-trips
  // (felt on every Personal tab switch).
  const [periods, categories, biometricCount, creditCardsRaw, spendCardsRaw, members, pastLoans, cardRemindersAll] = await Promise.all([
    prisma.personalPeriod.findMany({
      where: { memberId: member.id },
      orderBy: [{ year: "desc" }, { month: "desc" }],
    }),
    prisma.personalCategory.findMany({
      where: { memberId: member.id, archived: false },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.webAuthnCredential.count({ where: { memberId: member.id, purpose: "personal" } }),
    // Active credit cards for the "Paid by card" picker (spend + fixed-line modals).
    prisma.financeAccount.findMany({
      where: { memberId: member.id, type: "credit_card", active: true },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      select: { id: true, name: true, color: true },
    }),
    // All active cards in the HOUSEHOLD for the day-to-day spend picker — your own AND other members'
    // (peer usage: you spend, they front the cash, you owe them). Own cards first, then each member's,
    // tagged with owner so the modal can group them and derive the cross-person debt. Credit stays
    // tag-only (dues run through getCardDues); debit/prepaid post to the owner's ledger + balance.
    prisma.financeAccount.findMany({
      where: { active: true, member: { householdId: member.householdId } },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      select: {
        id: true, name: true, color: true, type: true, memberId: true, member: { select: { name: true } }, personalPrimary: true,
        credit: { select: { statementDay: true, dueOffsetDays: true } },
      },
    }),
    // Other household members — the split/reimburse picker mirrors a shared spend into their Lending tab
    // and notifies them, exactly like a peer-card spend does for the card owner.
    prisma.member.findMany({
      where: { householdId: member.householdId, id: { not: member.id } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    // Past OUTSIDE people (typed names, not household members) you've split/lent with before — offered as
    // quick-picks in the split "Someone else" box so you don't retype the same name. Linked (household)
    // loans carry the member's name and are picked from the members list instead, so filter to the
    // single-sided (linkGroup null) typed names.
    prisma.personalLoan.findMany({
      where: { memberId: member.id, linkGroup: null },
      select: { counterparty: true },
      distinct: ["counterparty"],
      orderBy: { counterparty: "asc" },
    }),
    // Due-bill reminders (soon/overdue) — drives the landing banner + the Finance-tab badge.
    getCardBillReminders(member.id),
  ]);

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

  const hasBiometric = biometricCount > 0;
  const creditCards = creditCardsRaw.map((a) => ({ id: a.id, name: a.name, color: a.color }));

  const spendCards = spendCardsRaw
    // statementDay/dueOffsetDays let the spend modal auto-derive a "collect by" date for a split paid on
    // a credit card (mirrors the peer-card cycle logic, client-side, so it can be shown disabled).
    .map((a) => ({
      id: a.id, name: a.name, color: a.color, type: a.type, ownerId: a.memberId, ownerName: a.member.name,
      mine: a.memberId === member.id, personal: false as boolean,
      statementDay: a.credit?.statementDay ?? null, dueOffsetDays: a.credit?.dueOffsetDays ?? null,
    }))
    .sort((a, b) => Number(b.mine) - Number(a.mine)); // your cards first
  // Your PERSONAL account (marked, or your only bank/cash/wallet account): a spend with no account picked
  // ("UPI") comes out of it — the spend modal names it.
  {
    const own = spendCardsRaw.filter((a) => a.memberId === member.id && ["bank", "cash", "debit_card", "prepaid_card"].includes(a.type));
    const pid = (own.find((a) => a.personalPrimary) ?? (own.length === 1 ? own[0] : null))?.id ?? null;
    for (const c of spendCards) c.personal = c.id === pid;
  }

  const cardReminders = creditCards.length > 0 ? cardRemindersAll : [];
  const pastNames = pastLoans.map((l) => l.counterparty).filter((n) => n.trim().length > 0);

  return {
    member,
    account,
    periods,
    selected,
    selYear: y ?? selected?.year ?? anchor.year,
    selMonth: m ?? selected?.month ?? anchor.month,
    categories,
    creditCards,
    spendCards,
    members,
    pastNames,
    cardReminders,
    hasBiometric,
  };
}
