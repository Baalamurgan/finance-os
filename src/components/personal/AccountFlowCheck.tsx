import { formatINR } from "@/lib/format";

export type AccountFlow = {
  id: number; name: string; color: string; balance: number;
  inTotal: number; outTotal: number; // the month's plan: money coming in / going out of this account
  after: number; // balance now + steps still to do (in − out)
};

// You define the transfers in Setup; this checks them. For every account the plan touches: what comes in
// (income received + transfers in), what goes out (bills + transfers out + savings), and where the balance
// lands once the steps still pending are done. An account that would end negative is short — it needs a
// transfer (or a bigger one). Bills with no account chosen are listed apart so they can't hide a shortfall.
export function AccountFlowCheck({ flows, unassignedBills }: { flows: AccountFlow[]; unassignedBills: number }) {
  if (flows.length === 0 && unassignedBills <= 0.005) return null;
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-800">Account check</h2>
      <p className="text-[11px] text-slate-400">What each account receives and pays out this month, and where it lands after the steps still to do.</p>
      <ul className="mt-3 space-y-2">
        {flows.map((a) => {
          const short = a.after < -0.5;
          return (
            <li key={a.id} className={`rounded-lg border p-2.5 ${short ? "border-red-200 bg-red-50/60" : "border-slate-100"}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-slate-800">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: a.color }} />
                  <span className="truncate">{a.name}</span>
                </span>
                <span className={`shrink-0 text-xs font-semibold ${short ? "text-red-700" : "text-emerald-700"}`}>
                  {short ? `short ${formatINR(-a.after)} — add a transfer` : "✓ covered"}
                </span>
              </div>
              <div className="mt-1.5 grid grid-cols-3 gap-2 text-[11px] text-slate-500">
                <span>in <b className="tabular-nums text-slate-700">{formatINR(a.inTotal)}</b></span>
                <span>out <b className="tabular-nums text-slate-700">{formatINR(a.outTotal)}</b></span>
                <span className="text-right">after <b className={`tabular-nums ${short ? "text-red-700" : "text-slate-700"}`}>{formatINR(a.after)}</b></span>
              </div>
              <div className="mt-0.5 text-[10px] text-slate-400">balance now {formatINR(a.balance)}</div>
            </li>
          );
        })}
      </ul>
      {unassignedBills > 0.005 && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {formatINR(unassignedBills)} of bills have no &ldquo;paid from&rdquo; account yet — pick one (tap the line under a bill) so this check can see them.
        </p>
      )}
    </section>
  );
}
