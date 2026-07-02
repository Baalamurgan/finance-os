import { formatINR } from "@/lib/format";
import { loadCommon } from "@/lib/load";
import { getLoans } from "@/lib/queries";
import { NavHeader } from "@/components/NavHeader";
import { ConfirmForm } from "@/components/ConfirmForm";
import { LoanPaymentForm } from "@/components/LoanPaymentForm";
import { createLoan, closeLoan, deleteLoan } from "../actions";

export default async function LoansPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  const sp = await searchParams;
  const c = await loadCommon(sp);
  if (!c) return null;

  const { rows, totalOutstanding, monthlyCommitment, activeLoans, activeChits, closed } =
    await getLoans(c.household.id);
  const periodId = c.selected?.id ?? null;

  return (
    <>
      <NavHeader
        active="loans"
        householdName={c.household.name}
        selYear={c.selYear}
        selMonth={c.selMonth}
        members={c.members}
        categories={c.categories}
        account={c.account}
        isHead={c.isHead}
        piggyBalance={c.piggyBalance}
        periodId={periodId}
        periodOpen={c.selected?.status === "open"}
        currentMemberId={c.currentMember?.id}
      />

      <main className="mx-auto max-w-4xl space-y-6 p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Loans &amp; Chits</h1>
            <p className="text-sm text-slate-500">
              Track outstanding balances and chit progress. Recording a payment reduces the balance;
              a prepayment is a payment that is fully principal.
            </p>
          </div>
          <div className="flex gap-3">
            <Stat label="Outstanding" value={formatINR(totalOutstanding)} accent />
            <Stat label="Monthly commitment" value={formatINR(monthlyCommitment)} />
          </div>
        </div>

        <Section title="Loans">
          {activeLoans.length === 0 ? (
            <Empty text="No active loans." />
          ) : (
            activeLoans.map((l) => (
              <LoanCard key={l.id} l={l} periodId={periodId} isHead={c.isHead} />
            ))
          )}
        </Section>

        <Section title="Chits">
          {activeChits.length === 0 ? (
            <Empty text="No active chits." />
          ) : (
            activeChits.map((l) => (
              <LoanCard key={l.id} l={l} periodId={periodId} isHead={c.isHead} />
            ))
          )}
        </Section>

        {closed.length > 0 && (
          <Section title="Closed">
            {closed.map((l) => (
              <div
                key={l.id}
                className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-500"
              >
                <span>
                  {l.name} <span className="text-xs">· {l.kind}</span>
                </span>
                <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px]">closed</span>
              </div>
            ))}
          </Section>
        )}

        {c.isHead && <AddLoan householdId={c.household.id} members={c.members} />}
      </main>
    </>
  );
}

function LoanCard({
  l,
  periodId,
  isHead,
}: {
  l: Awaited<ReturnType<typeof getLoans>>["rows"][number];
  periodId: number | null;
  isHead: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-semibold text-slate-800">{l.name}</div>
          <div className="text-xs text-slate-400">
            {l.memberName ? `${l.memberName} · ` : ""}
            {formatINR(l.monthlyAmount)}/mo
          </div>
        </div>
        <div className="text-right">
          {l.kind === "chit" && l.totalInstallments ? (
            <>
              <div className="text-sm font-bold tabular-nums text-indigo-700">
                {l.paidInstallments} / {l.totalInstallments}
              </div>
              <div className="mt-1 h-1.5 w-28 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full bg-indigo-500"
                  style={{ width: `${Math.round((l.progress ?? 0) * 100)}%` }}
                />
              </div>
            </>
          ) : (
            <div className="text-sm font-bold tabular-nums text-indigo-700">
              {formatINR(l.outstanding)} <span className="text-xs font-normal text-slate-400">left</span>
            </div>
          )}
        </div>
      </div>

      {isHead && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          <LoanPaymentForm loanId={l.id} periodId={periodId} kind={l.kind} outstanding={l.outstanding} />
          <ConfirmForm action={closeLoan} message={`Close ${l.name}? It moves to the Closed list.`}>
            <input type="hidden" name="loanId" value={l.id} />
            <button className="rounded-md px-2 py-1.5 text-xs text-slate-500 hover:bg-slate-100">
              Close
            </button>
          </ConfirmForm>
          <ConfirmForm action={deleteLoan} message={`Delete ${l.name} permanently? This removes its payment history.`}>
            <input type="hidden" name="loanId" value={l.id} />
            <button className="rounded-md px-2 py-1.5 text-xs text-slate-300 hover:text-red-600">
              Delete
            </button>
          </ConfirmForm>
        </div>
      )}

      {l.payments.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-slate-400">
          {l.payments.map((p) => (
            <li key={p.id} className="flex justify-between">
              <span>
                {new Date(p.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                {p.note ? ` · ${p.note}` : ""}
                {p.principalPart > 0 ? ` · principal ${formatINR(p.principalPart)}` : ""}
              </span>
              <span className="tabular-nums">{formatINR(p.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AddLoan({
  householdId,
  members,
}: {
  householdId: number;
  members: { id: number; name: string }[];
}) {
  return (
    <details className="rounded-xl border border-dashed border-slate-300 bg-white p-4">
      <summary className="cursor-pointer text-sm font-medium text-indigo-600">
        + Add a loan or chit
      </summary>
      <form action={createLoan} className="mt-3 flex flex-wrap items-end gap-3">
        <input type="hidden" name="householdId" value={householdId} />
        <label className="text-xs text-slate-500">
          Name
          <input name="name" required placeholder="BOB loan" className="input mt-0.5 block w-40" />
        </label>
        <label className="text-xs text-slate-500">
          Type
          <select name="kind" className="input mt-0.5 block">
            <option value="loan">Loan</option>
            <option value="chit">Chit</option>
          </select>
        </label>
        <label className="text-xs text-slate-500">
          Outstanding (loan)
          <input name="outstanding" type="number" step="0.01" placeholder="0" className="input mt-0.5 block w-32" />
        </label>
        <label className="text-xs text-slate-500">
          Monthly amount
          <input name="monthlyAmount" type="number" step="0.01" placeholder="0" className="input mt-0.5 block w-32" />
        </label>
        <label className="text-xs text-slate-500">
          Total installments (chit)
          <input name="totalInstallments" type="number" placeholder="20" className="input mt-0.5 block w-28" />
        </label>
        <label className="text-xs text-slate-500">
          Paid so far (chit)
          <input name="paidInstallments" type="number" defaultValue="0" className="input mt-0.5 block w-20" />
        </label>
        <label className="text-xs text-slate-500">
          Responsible
          <select name="memberId" className="input mt-0.5 block">
            <option value="">Shared</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <button className="btn">Add</button>
      </form>
    </details>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
      {children}
    </section>
  );
}
function Empty({ text }: { text: string }) {
  return <p className="rounded-lg border border-slate-100 bg-white px-4 py-3 text-sm text-slate-400">{text}</p>;
}
function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="text-right">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`text-lg font-bold tabular-nums ${accent ? "text-indigo-700" : "text-slate-800"}`}>
        {value}
      </div>
    </div>
  );
}
