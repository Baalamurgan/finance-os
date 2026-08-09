import { formatINR } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { loadPersonal } from "@/lib/loadPersonal";
import { PersonalNav } from "@/components/personal/PersonalNav";
import {
  addPersonalLoan,
  recordPersonalLoanPayment,
  settlePersonalLoan,
  deletePersonalLoan,
} from "@/app/personal/actions";

export default async function PersonalLoans({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  const sp = await searchParams;
  const c = await loadPersonal(sp);
  const nav = <PersonalNav active="loans" name={c.account.name} selYear={c.selYear} selMonth={c.selMonth} financeDue={c.cardReminders.length > 0} />;

  const loans = await prisma.personalLoan.findMany({
    where: { memberId: c.member.id },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });
  const lent = loans.filter((l) => l.direction === "lent");
  const borrowed = loans.filter((l) => l.direction === "borrowed");
  const owedToYou = lent.filter((l) => l.status === "open").reduce((s, l) => s + l.outstanding, 0);
  const youOwe = borrowed.filter((l) => l.status === "open").reduce((s, l) => s + l.outstanding, 0);

  return (
    <>
      {nav}
      <main className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
        <h1 className="text-xl font-bold text-slate-900">Lending &amp; borrowing</h1>

        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <div className="text-[11px] font-medium uppercase tracking-wide text-emerald-700">Owed to you</div>
            <div className="mt-1 text-2xl font-bold text-emerald-800">{formatINR(owedToYou)}</div>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div className="text-[11px] font-medium uppercase tracking-wide text-amber-700">You owe</div>
            <div className="mt-1 text-2xl font-bold text-amber-800">{formatINR(youOwe)}</div>
          </div>
        </div>

        {/* add */}
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Record lending / borrowing</h2>
          <form action={addPersonalLoan} className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <select name="direction" className="input" defaultValue="lent">
              <option value="lent">I lent</option>
              <option value="borrowed">I borrowed</option>
            </select>
            <input name="counterparty" placeholder="Person *" required className="input" />
            <input name="amount" type="number" step="0.01" placeholder="₹ *" required className="input" />
            <input name="note" placeholder="Note" className="input" />
            <button className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700">Add</button>
          </form>
        </section>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <LoanList title="You lent" loans={lent} accent="emerald" />
          <LoanList title="You borrowed" loans={borrowed} accent="amber" />
        </div>
      </main>
    </>
  );
}

function LoanList({
  title,
  loans,
  accent,
}: {
  title: string;
  loans: { id: number; counterparty: string; amount: number; outstanding: number; note: string | null; status: string; sharedPaid: number | null; sharedShare: number | null }[];
  accent: "emerald" | "amber";
}) {
  const amountColor = accent === "emerald" ? "text-emerald-700" : "text-amber-700";
  // Group by counterparty so multiple lends/borrows with the SAME person roll up under one header
  // showing their combined open total — while each individual entry keeps its own record/settle/delete.
  const groups = new Map<string, typeof loans>();
  for (const l of loans) {
    const key = l.counterparty.trim();
    const arr = groups.get(key);
    if (arr) arr.push(l);
    else groups.set(key, [l]);
  }
  const groupList = [...groups.entries()]
    .map(([name, items]) => ({ name, items, openTotal: items.filter((l) => l.status === "open").reduce((s, l) => s + l.outstanding, 0) }))
    .sort((a, b) => b.openTotal - a.openTotal || a.name.localeCompare(b.name));
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-900">{title}</h2>
      {loans.length === 0 ? (
        <p className="text-sm text-slate-400">Nothing here.</p>
      ) : (
        <ul className="space-y-3">
          {groupList.map((g) => (
            <li key={g.name}>
              <div className="flex items-center justify-between border-b border-slate-100 pb-1">
                <span className="font-semibold text-slate-800">
                  {g.name}
                  {g.items.length > 1 && <span className="ml-1 text-[10px] font-normal text-slate-400">({g.items.length} entries)</span>}
                </span>
                <span className={`tabular-nums font-bold ${g.openTotal <= 0.005 ? "text-slate-400" : amountColor}`}>{formatINR(g.openTotal)}</span>
              </div>
              <ul className="divide-y divide-slate-100">
                {g.items.map((l) => (
                  <li key={l.id} className="py-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-400">{l.note || (l.sharedPaid != null ? "Shared spend" : "—")}</span>
                      <span className={`tabular-nums text-sm font-medium ${l.status === "settled" ? "text-slate-400 line-through" : amountColor}`}>
                        {formatINR(l.outstanding)}
                      </span>
                    </div>
                    {l.sharedPaid != null && (
                      <div className="mt-0.5 inline-flex flex-wrap items-center gap-1.5 rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">
                        🤝 Shared spend · you paid {formatINR(l.sharedPaid)} · your share {formatINR(l.sharedShare ?? 0)}
                      </div>
                    )}
                    {l.status === "open" && (
                      <div className="mt-1.5 flex items-center gap-2">
                        <form action={recordPersonalLoanPayment} className="flex items-center gap-1">
                          <input type="hidden" name="id" value={l.id} />
                          <input name="amount" type="number" step="0.01" placeholder="₹ recd" className="input w-24 py-1 text-xs" />
                          <button className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200">Record</button>
                        </form>
                        <form action={settlePersonalLoan}>
                          <input type="hidden" name="id" value={l.id} />
                          <button className="text-xs font-medium text-emerald-700">{l.sharedPaid != null ? "Mark received" : "Settle"}</button>
                        </form>
                        <form action={deletePersonalLoan}>
                          <input type="hidden" name="id" value={l.id} />
                          <button className="text-xs text-slate-400 hover:text-red-600">Delete</button>
                        </form>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
