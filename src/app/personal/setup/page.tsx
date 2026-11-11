import { prisma } from "@/lib/prisma";
import { loadPersonal } from "@/lib/loadPersonal";
import { PersonalNav } from "@/components/personal/PersonalNav";
import { PersonalRecurringSection } from "@/components/personal/PersonalRecurringManager";
import { RecurringTransfersSection } from "@/components/personal/RecurringTransfersSection";
import { getWalletAccounts } from "@/lib/finance/queries";
import { PersonalSecurity } from "@/components/personal/PersonalSecurity";
import { setPersonalWindDownDay, setPersonalCategoryBucket } from "@/app/personal/actions";
import { ensureTemplates, monthCopies } from "@/lib/personal/templates";

const BUCKETS = [
  { key: "need", label: "Need", cls: "bg-emerald-600" },
  { key: "want", label: "Want", cls: "bg-violet-600" },
  { key: "invest", label: "Invest", cls: "bg-amber-500" },
] as const;

export default async function PersonalSetup({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  const sp = await searchParams;
  const c = await loadPersonal(sp);
  const nav = <PersonalNav active="setup" account={c.account} selYear={c.selYear} selMonth={c.selMonth} financeDue={c.cardReminders.length > 0} />;

  const catList = c.categories.map((cat) => ({ id: cat.id, name: cat.name, icon: cat.icon, bucket: cat.bucket }));
  // Net-worth holdings an Invest bill / saving can feed (personal only).
  const holdingOpts = await prisma.netWorthItem.findMany({ where: { memberId: c.member.id, category: "asset" }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  // Every active account of the member: bank, cash, debit/prepaid and credit cards (the "Paid from" picker).
  const payAccounts = await prisma.financeAccount.findMany({ where: { memberId: c.member.id, active: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }], select: { id: true, name: true, type: true } });
  // "Apply to this month" targets the month you're viewing (open month or its preview — never a closed one).
  const periodId = c.selected && c.selected.status !== "closed" ? c.selected.id : null;
  // Setup = the member's templates (PersonalTemplate), kept apart from any month. Each item also shows this
  // month's own copy when it differs, with "Apply to this month".
  await ensureTemplates(c.member.id);
  const [templates, copies] = await Promise.all([
    prisma.personalTemplate.findMany({ where: { memberId: c.member.id, active: true }, orderBy: [{ amount: "desc" }, { id: "asc" }] }),
    periodId != null ? monthCopies(periodId) : Promise.resolve(new Map()),
  ]);
  const monthLabel = c.selected?.label ?? "";
  const toItem = (t: (typeof templates)[number]) => {
    const m = copies.get(t.id);
    const payId = t.kind === "income" ? t.accountId : t.cardAccountId ?? t.payAccountId;
    const differs = m == null || m.amount !== t.amount || m.label !== t.label || m.day !== t.dayOfMonth || (m.payId ?? null) !== (payId ?? null);
    return {
      id: t.id, label: t.label, amount: t.amount, day: t.dayOfMonth, categoryId: t.categoryId,
      cardAccountId: t.kind === "income" ? null : payId, accountId: t.kind === "income" ? t.accountId : null, holdingId: t.holdingId,
      month: periodId == null ? null : { label: monthLabel, missing: m == null, amount: m?.amount ?? null, done: m?.done ?? false, differs },
    };
  };
  const incomeItems = templates.filter((t) => t.kind === "income").map(toItem);
  const expenseItems = templates.filter((t) => t.kind === "expense").map(toItem);
  const spendItems = templates.filter((t) => t.kind === "spend").map(toItem);
  // Balance accounts (for the income "deposited into" picker + the recurring transfers) and the member's
  // active transfer/save templates — each with this month's step (if any) for the same "Apply" note.
  const wallet = await getWalletAccounts(c.member.id);
  const balAccts = wallet.filter((w) => w.balance != null).map((w) => ({ id: w.account.id, name: w.account.name, balance: w.balance ?? 0 }));
  const acctOpts = balAccts.map((a) => ({ id: a.id, name: a.name }));
  const planItemRows = await prisma.personalPlanItem.findMany({
    where: { memberId: c.member.id, active: true },
    orderBy: [{ dayOfMonth: "asc" }, { id: "asc" }],
    select: { id: true, kind: true, label: true, amount: true, dayOfMonth: true, fromAccountId: true, toAccountId: true, note: true, holdingId: true },
  });
  const itemSteps = periodId != null ? await prisma.personalPlanStep.findMany({ where: { periodId, templateKind: "planitem" }, select: { templateId: true, label: true, amount: true, dayOfMonth: true, fromAccountId: true, toAccountId: true, status: true } }) : [];
  const planItems = planItemRows.map((it) => {
    const st = itemSteps.find((x) => x.templateId === it.id);
    const differs = !st || st.amount !== it.amount || st.label !== it.label || st.dayOfMonth !== it.dayOfMonth || st.fromAccountId !== it.fromAccountId || st.toAccountId !== it.toAccountId;
    return { ...it, month: periodId == null ? null : { label: monthLabel, missing: !st, amount: st?.amount ?? null, done: st?.status === "done", differs } };
  });

  return (
    <>
      {nav}
      <main className="fo-rise mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
        <h1 className="text-xl font-bold text-slate-900">Personal setup</h1>

        <p className="-mb-1 text-xs text-slate-500">
          Everything here repeats <b>every month automatically</b> — each new month (and its preview) gets its
          own copy on the 1st, steps included. Editing Setup <b>never changes the current month</b>; where this
          month differs you&apos;ll see it, with <b>Apply to this month</b> if you want it there too. Editing a
          month&apos;s line (Sheet, Spends, plan) never changes Setup.
        </p>

        {/* Recurring income / expenses / spends — the monthly template */}
        <PersonalRecurringSection
          kind="income"
          title="💰 Recurring income"
          hint="Salary, rent received, interest — added to each month on its day."
          items={incomeItems}
          periodId={periodId}
          categories={catList}
          payAccounts={payAccounts}
          accounts={acctOpts}
          holdings={holdingOpts}
        />
        <PersonalRecurringSection
          kind="expense"
          title="🧾 Recurring expenses"
          hint="Rent, EMIs, subscriptions — fixed bills each month. They sit in Monthly expenses (set aside from day one) and come into your Money Plan to tick off when paid, from the account you pick; a credit card puts it on the card bill."
          items={expenseItems}
          periodId={periodId}
          categories={catList}
          payAccounts={payAccounts}
          accounts={acctOpts}
          holdings={holdingOpts}
        />
        <PersonalRecurringSection
          kind="spend"
          title="🛒 Recurring spends"
          hint="Regular daily-type spends (gym, chai, fuel) that repeat each month on their day. They are copied into your Spends tab each month as planned entries — mark one paid there (pick Cash/UPI or a card) and it comes out of Can-spend."
          items={spendItems}
          periodId={periodId}
          categories={catList}
          payAccounts={payAccounts}
          accounts={acctOpts}
          holdings={holdingOpts}
        />

        {/* Recurring transfers & savings — templates for the plan's transfer/save steps */}
        <RecurringTransfersSection items={planItems} accounts={balAccts} periodId={periodId} holdings={holdingOpts} />

        {/* Close day */}
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">Month close day</h2>
          <p className="mt-0.5 text-xs text-slate-500">Your month boundary. Months roll over automatically.</p>
          <form action={setPersonalWindDownDay} className="mt-3 flex items-end gap-2">
            <input
              type="number"
              name="windDownDay"
              min={1}
              max={28}
              defaultValue={c.member.personalWindDownDay ?? ""}
              placeholder="—"
              className="w-24 rounded-md border border-slate-300 px-2 py-1.5 text-sm shadow-sm"
            />
            <button className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700">Save</button>
          </form>
        </section>

        {/* 50/30/20 buckets */}
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">Category buckets (50/30/20)</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Classify each category as a <b>Need</b>, <b>Want</b> or <b>Investment</b> — this drives the
            Analysis tab&apos;s 50/30/20 split.
          </p>
          <div className="mt-3 space-y-2">
            {c.categories.map((cat) => (
              <div key={cat.id} className="flex items-center justify-between gap-2">
                <span className="truncate text-sm text-slate-700">
                  {cat.icon} {cat.name}
                </span>
                <form action={setPersonalCategoryBucket} className="flex gap-1">
                  <input type="hidden" name="id" value={cat.id} />
                  {BUCKETS.map((b) => (
                    <button
                      key={b.key}
                      name="bucket"
                      value={b.key}
                      className={`rounded-md px-2 py-1 text-xs font-medium ${
                        cat.bucket === b.key ? `${b.cls} text-white` : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                      }`}
                    >
                      {b.label}
                    </button>
                  ))}
                </form>
              </div>
            ))}
          </div>
        </section>

        <PersonalSecurity hasBiometric={c.hasBiometric} />

        {/* Personal OS: connect Google (calendar / tasks / contacts) for the Today dashboard. */}
        <a
          href="/personal/settings/permissions"
          className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 hover:bg-slate-50"
        >
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Permissions &amp; integrations</h2>
            <p className="mt-0.5 text-xs text-slate-500">Connect Google Calendar, Tasks &amp; Contacts for your Today dashboard.</p>
          </div>
          <span className="text-slate-300">→</span>
        </a>

        {/* Personal OS: bring-your-own-key AI assistant. */}
        <a
          href="/personal/settings/assistant"
          className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 hover:bg-slate-50"
        >
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Assistant</h2>
            <p className="mt-0.5 text-xs text-slate-500">Bring your own AI key (Anthropic or OpenAI) for your daily briefing.</p>
          </div>
          <span className="text-slate-300">→</span>
        </a>
      </main>
    </>
  );
}
