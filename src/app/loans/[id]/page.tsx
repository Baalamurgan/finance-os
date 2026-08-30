import Link from "next/link";
import { notFound } from "next/navigation";
import { formatINR } from "@/lib/format";
import { loadCommon } from "@/lib/load";
import { getLoanDetail } from "@/lib/queries";
import { NavHeader } from "@/components/NavHeader";
import { ConfirmForm } from "@/components/ConfirmForm";
import { recordLoanPayment, setChitWon, deleteLoanPayment, closeLoan } from "@/app/actions";

export default async function LoanDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const c = await loadCommon(sp);
  if (!c) return null;
  const detail = await getLoanDetail(c.household.id, Number(id));
  if (!detail) notFound();

  const { loan, memberName, totalPaid, totalDividend, potReceived, chitNet } = detail;
  const isChit = loan.kind === "chit";
  const canEdit = c.isHead;

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
        periodId={c.selected?.id ?? null}
        periodOpen={c.selected?.status === "open"}
        currentMemberId={c.currentMember?.id}
        windDownReminder={c.windDownReminder}
        canEdit={c.canEdit}
        pinEnabled={c.pinEnabled}
        hasBiometric={c.hasBiometric}
        actualIsHead={c.actualIsHead}
        viewingAsMember={c.viewingAsMember}
      />

      <main className="mx-auto max-w-2xl space-y-5 p-4 sm:p-6">
        <Link href="/loans" className="text-sm text-indigo-600 hover:underline">← Loans &amp; Chits</Link>

        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold text-slate-900">{loan.name}</h1>
            <p className="text-sm text-slate-500">
              {isChit ? "Chit fund" : "Loan"}
              {memberName ? ` · ${memberName}` : ""}
              {loan.interestRate ? ` · ${loan.interestRate}% p.a.` : ""}
              {loan.status === "closed" ? " · closed" : ""}
            </p>
          </div>
          <div className="text-right">
            {isChit && loan.totalInstallments ? (
              <>
                <div className="text-lg font-bold tabular-nums text-indigo-700">
                  {loan.paidInstallments} / {loan.totalInstallments}
                </div>
                <div className="mt-1 h-1.5 w-32 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full bg-indigo-500" style={{ width: `${Math.min(100, Math.round((loan.paidInstallments / loan.totalInstallments) * 100))}%` }} />
                </div>
              </>
            ) : (
              <div className="text-lg font-bold tabular-nums text-indigo-700">
                {formatINR(loan.outstanding)} <span className="text-xs font-normal text-slate-400">left</span>
              </div>
            )}
          </div>
        </div>

        {/* summary */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Monthly" value={formatINR(loan.monthlyAmount)} />
          <Stat label="Paid so far" value={formatINR(totalPaid)} />
          {isChit ? (
            <>
              <Stat label="Dividends" value={formatINR(totalDividend)} />
              <Stat label="Net cost" value={formatINR(chitNet)} accent />
            </>
          ) : (
            <Stat label="Outstanding" value={formatINR(loan.outstanding)} accent />
          )}
        </div>

        {/* chit: pot won */}
        {isChit && (
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-900">Pot</h2>
            {loan.chitWonInstallment ? (
              <p className="mt-1 text-sm text-emerald-700">
                Won on installment {loan.chitWonInstallment} · {formatINR(potReceived)} received.
              </p>
            ) : (
              <p className="mt-1 text-sm text-slate-500">Not won yet.</p>
            )}
            {canEdit && (
              <form action={setChitWon} className="mt-3 flex flex-wrap items-end gap-2">
                <input type="hidden" name="loanId" value={loan.id} />
                <label className="text-xs text-slate-500">
                  Installment #
                  <input name="installment" type="number" min={1} defaultValue={loan.chitWonInstallment ?? ""} className="input mt-0.5 block w-20" />
                </label>
                <label className="text-xs text-slate-500">
                  Pot amount (₹)
                  <input name="potAmount" type="number" step="0.01" defaultValue={loan.chitPotAmount ?? ""} className="input mt-0.5 block w-32" />
                </label>
                <button className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700">Save</button>
              </form>
            )}
          </section>
        )}

        {/* record payment */}
        {canEdit && loan.status !== "closed" && (
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-900">Record a {isChit ? "monthly installment" : "payment"}</h2>
            <form action={recordLoanPayment} className="mt-3 flex flex-wrap items-end gap-2">
              <input type="hidden" name="loanId" value={loan.id} />
              {c.selected && <input type="hidden" name="periodId" value={c.selected.id} />}
              <label className="text-xs text-slate-500">
                Amount paid (₹)
                <input name="amount" type="number" step="0.01" required defaultValue={loan.monthlyAmount || ""} className="input mt-0.5 block w-28" />
              </label>
              {isChit ? (
                <label className="text-xs text-slate-500">
                  Dividend got (₹)
                  <input name="dividend" type="number" step="0.01" placeholder="0" className="input mt-0.5 block w-28" />
                </label>
              ) : (
                <label className="text-xs text-slate-500">
                  Principal part (₹)
                  <input name="principalPart" type="number" step="0.01" placeholder="0" className="input mt-0.5 block w-28" />
                </label>
              )}
              <label className="text-xs text-slate-500">
                Note
                <input name="note" className="input mt-0.5 block w-32" />
              </label>
              <button className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">Add</button>
            </form>
          </section>
        )}

        {/* payment history */}
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">Payment history</h2>
          {loan.payments.length === 0 ? (
            <p className="mt-2 text-sm text-slate-400">No payments recorded yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-100">
              {loan.payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between py-2 text-sm">
                  <div className="min-w-0">
                    <div className="text-slate-700">
                      {formatINR(p.amount)}
                      {p.dividend > 0 ? <span className="text-emerald-600"> · +{formatINR(p.dividend)} dividend</span> : ""}
                      {p.principalPart > 0 ? <span className="text-slate-400"> · principal {formatINR(p.principalPart)}</span> : ""}
                    </div>
                    <div className="text-xs text-slate-400">
                      {new Date(p.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" })}
                      {p.note ? ` · ${p.note}` : ""}
                    </div>
                  </div>
                  {canEdit && (
                    <ConfirmForm action={deleteLoanPayment} message="Remove this payment?">
                      <input type="hidden" name="id" value={p.id} />
                      <button className="text-xs text-slate-300 hover:text-red-600">Delete</button>
                    </ConfirmForm>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {canEdit && loan.status !== "closed" && (
          <ConfirmForm action={closeLoan} message={`Close ${loan.name}?`}>
            <input type="hidden" name="loanId" value={loan.id} />
            <button className="text-sm text-slate-500 hover:text-slate-800">Mark as closed</button>
          </ConfirmForm>
        )}
      </main>
    </>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-0.5 text-lg font-bold tabular-nums ${accent ? "text-indigo-700" : "text-slate-800"}`}>{value}</div>
    </div>
  );
}
