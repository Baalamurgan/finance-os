import Link from "next/link";
import { formatINR } from "@/lib/format";
import { loadCommon } from "@/lib/load";
import { getLoans, getDebtOverview } from "@/lib/queries";
import { NavHeader } from "@/components/NavHeader";
import { ConfirmForm } from "@/components/ConfirmForm";
import { LoanPaymentForm } from "@/components/LoanPaymentForm";
import { LoanForm } from "@/components/LoanForm";
import { DebtOverview } from "@/components/DebtOverview";
import { DebtPlan } from "@/components/DebtPlan";
import { closeLoan, deleteLoan } from "../actions";

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { month: "short", year: "numeric" }) : "—");

export default async function LoansPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  const sp = await searchParams;
  const c = await loadCommon(sp);
  if (!c) return null;

  const { totalOutstanding, monthlyCommitment, activeLoans, activeChits, closed } =
    await getLoans(c.household.id);
  const debt = activeLoans.length > 0 ? await getDebtOverview(c.household.id) : null;
  const periodId = c.selected?.id ?? null;

  return (
    <>
      <NavHeader
        active="loans"
        householdName={c.household.name}
        miscSubCategories={c.miscSubCategories}
        selYear={c.selYear}
        selMonth={c.selMonth}
        previewPeriod={c.previewPeriod}
        provisional={c.provisional}
        members={c.members}        categories={c.categories}
        account={c.account}
        isHead={c.isHead}
        piggyBalance={c.piggyBalance}
        periodId={periodId}
        periodOpen={c.selected?.status === "open"}
        currentMemberId={c.currentMember?.id}
        windDownReminder={c.windDownReminder}
        canEdit={c.canEdit}
        pinEnabled={c.pinEnabled}
        hasBiometric={c.hasBiometric}
        actualIsHead={c.actualIsHead}
        viewingAsMember={c.viewingAsMember}
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

        {debt && debt.planLoans.current.length >= 1 && (
          <DebtPlan current={debt.planLoans.current} planned={debt.planLoans.planned} hasPlan={debt.hasPlan} />
        )}
        {debt && (
          <details className="group rounded-xl border border-slate-200 bg-white">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50">
              <span>See the full breakdown</span>
              <span className="text-xs text-slate-400 group-open:hidden">▸ totals &amp; chart</span>
              <span className="hidden text-xs text-slate-400 group-open:inline">▾ hide</span>
            </summary>
            <div className="border-t border-slate-100 p-4">
              <DebtOverview current={debt.current} planned={debt.planned} hasPlan={debt.hasPlan} interestSaved={debt.interestSaved} />
            </div>
          </details>
        )}

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

        {c.isHead && (
          <details className="rounded-xl border border-dashed border-slate-300 bg-white p-4">
            <summary className="cursor-pointer text-sm font-medium text-indigo-600">+ Add a loan or chit</summary>
            <div className="mt-3">
              <LoanForm mode="create" householdId={c.household.id} members={c.members} />
            </div>
          </details>
        )}
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
          <Link href={`/loans/${l.id}`} className="font-semibold text-indigo-700 hover:underline">
            {l.name} <span className="text-xs font-normal text-slate-400">· details →</span>
          </Link>
          <div className="text-xs text-slate-400">
            {l.memberName ? `${l.memberName} · ` : ""}
            {formatINR(l.monthlyAmount)}/mo
          </div>
        </div>
        <div className="text-right">
          {l.needsDetails ? (
            <Link href={`/loans/${l.id}`} className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700 hover:bg-amber-100">
              + Add details
            </Link>
          ) : l.kind === "chit" && l.totalInstallments ? (
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
            <>
              <div className="text-sm font-bold tabular-nums text-indigo-700">
                {formatINR(l.outstanding)} <span className="text-xs font-normal text-slate-400">left</span>
              </div>
              <div className="text-[11px] text-slate-400">
                {l.interestOnly ? "interest-only" : l.payoffISO ? `payoff ${fmtDate(l.payoffISO)}` : ""}
              </div>
            </>
          )}
        </div>
      </div>

      {isHead && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          <LoanPaymentForm loanId={l.id} periodId={periodId} kind={l.kind} outstanding={l.outstanding} />
          <ConfirmForm action={closeLoan} successMessage="Loan closed" message={`Close ${l.name}? It moves to the Closed list.`}>
            <input type="hidden" name="loanId" value={l.id} />
            <button className="rounded-md px-2 py-1.5 text-xs text-slate-500 hover:bg-slate-100">
              Close
            </button>
          </ConfirmForm>
          <ConfirmForm action={deleteLoan} successMessage="Loan deleted" message={`Delete ${l.name} permanently? This removes its payment history.`}>
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
