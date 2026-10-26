import { prisma } from "@/lib/prisma";
import { loadPersonal } from "@/lib/loadPersonal";
import { PersonalNav } from "@/components/personal/PersonalNav";
import { PersonalRecurringSection } from "@/components/personal/PersonalRecurringManager";
import { PersonalSecurity } from "@/components/personal/PersonalSecurity";
import { setPersonalWindDownDay, setPersonalCategoryBucket } from "@/app/personal/actions";

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
  const nav = <PersonalNav active="setup" name={c.account.name} selYear={c.selYear} selMonth={c.selMonth} financeDue={c.cardReminders.length > 0} />;

  const catList = c.categories.map((cat) => ({ id: cat.id, name: cat.name, icon: cat.icon }));
  const cardOpts = c.creditCards.map((k) => ({ id: k.id, name: k.name, color: k.color }));
  const periodId = c.selected?.id ?? null;
  // Recurring templates live as `recurring: true` rows in the current month (they clone forward each month,
  // dated to their day). One list per kind for the three setup sections.
  const recIncome = c.selected ? await prisma.personalIncome.findMany({ where: { periodId: c.selected.id, recurring: true }, orderBy: { amount: "desc" } }) : [];
  const recExpense = c.selected ? await prisma.personalExpense.findMany({ where: { periodId: c.selected.id, recurring: true }, orderBy: { amount: "desc" } }) : [];
  const recSpend = c.selected ? await prisma.personalSpend.findMany({ where: { periodId: c.selected.id, recurring: true }, orderBy: { amount: "desc" } }) : [];
  const incomeItems = recIncome.map((e) => ({ id: e.id, label: e.source, amount: e.amount, day: e.date.getDate(), categoryId: null, cardAccountId: null }));
  const expenseItems = recExpense.map((e) => ({ id: e.id, label: e.label, amount: e.amount, day: e.date.getDate(), categoryId: e.categoryId, cardAccountId: e.cardAccountId }));
  const spendItems = recSpend.map((e) => ({ id: e.id, label: e.note ?? "", amount: e.amount, day: e.date.getDate(), categoryId: e.categoryId, cardAccountId: e.cardAccountId }));

  return (
    <>
      {nav}
      <main className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
        <h1 className="text-xl font-bold text-slate-900">Personal setup</h1>

        <p className="-mb-1 text-xs text-slate-500">
          Everything here repeats <b>every month automatically</b> — each entry lands on its day on your
          Spends/Expenses tabs. Edit or remove any; changes apply from next month.
        </p>

        {/* Recurring income / expenses / spends — the monthly template */}
        <PersonalRecurringSection
          kind="income"
          title="💰 Recurring income"
          hint="Salary, rent received, interest — added to each month on its day."
          items={incomeItems}
          periodId={periodId}
          categories={catList}
          cards={cardOpts}
        />
        <PersonalRecurringSection
          kind="expense"
          title="🧾 Recurring expenses"
          hint="Rent, EMIs, subscriptions — fixed bills each month. Pick a card to put it on the card bill."
          items={expenseItems}
          periodId={periodId}
          categories={catList}
          cards={cardOpts}
        />
        <PersonalRecurringSection
          kind="spend"
          title="🛒 Recurring spends"
          hint="Regular daily-type spends (gym, chai, fuel) that repeat each month on their day."
          items={spendItems}
          periodId={periodId}
          categories={catList}
          cards={cardOpts}
        />

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
