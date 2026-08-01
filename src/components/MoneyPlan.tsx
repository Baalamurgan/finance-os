"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatINR } from "@/lib/format";
import { markSettled, unsettle, toggleBillPaid, syncMonthFromSetup } from "@/app/actions";
import { PayBillModal } from "@/components/PayBillModal";
import { useToast } from "@/components/Toast";
import type { MoneyPlanResult } from "@/lib/queries";

// The shared, everyone-visible Money Plan: the month's transfers + bill payments as one ordered,
// dated checklist. Ticking a step writes through to the real record (settlement / bill paid) — the
// action itself enforces "head or the two parties involved". Done steps strike through in green.
// A member filter narrows to just one person's remaining to-dos (keeping each step's real number);
// Refresh re-pulls due dates + amounts from Setup into this month, then re-orders the plan.
export function MoneyPlan({
  plan, householdId, periodId, isHead, currentMemberId, canEdit, open, generalPiggy,
}: {
  plan: MoneyPlanResult;
  householdId: number;
  periodId: number;
  isHead: boolean;
  currentMemberId: number | null;
  canEdit: boolean;
  open: boolean;
  generalPiggy: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [who, setWho] = useState<number | null>(null);

  // Everyone involved in a step (payer / from / to) → the filter's member list.
  const people = useMemo(() => {
    const m = new Map<number, string>();
    for (const s of plan.steps) {
      if (s.fromId != null && s.fromName) m.set(s.fromId, s.fromName);
      if (s.toId != null && s.toName) m.set(s.toId, s.toName);
      if (s.payerId != null && s.payerName) m.set(s.payerId, s.payerName);
    }
    return [...m.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [plan.steps]);

  if (plan.total === 0) return null;
  const pct = plan.total ? Math.round((plan.done / plan.total) * 100) : 0;

  // Keep each step's REAL number (its position in the full plan); when a member is picked, show
  // only their remaining to-dos.
  const rows = plan.steps.map((s, i) => ({ s, n: i + 1 }));
  const shown = who == null
    ? rows
    : rows.filter(({ s }) => !s.done && (s.fromId === who || s.toId === who || s.payerId === who));
  const whoName = people.find((p) => p.id === who)?.name;

  const refresh = () =>
    startTransition(async () => {
      const r = await syncMonthFromSetup(householdId, periodId);
      router.refresh();
      toast(r.ok ? (r.updated > 0 ? `Refreshed — ${r.updated} line${r.updated > 1 ? "s" : ""} synced from Setup` : "Already up to date with Setup") : (r.error ?? "Couldn't refresh"), r.ok ? "success" : "error");
    });

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">🧭 Money plan</h2>
          <p className="text-[11px] text-slate-400">The order to move money this month. Tick each as it happens.</p>
        </div>
        <span className="shrink-0 text-xs font-medium text-slate-500">{plan.done}/{plan.total} done</span>
      </div>

      {/* progress (always the WHOLE plan, not the filtered view) */}
      <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
      </div>

      {/* filter + refresh */}
      <div className="mb-3 flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto pb-0.5">
          <FilterPill active={who == null} onClick={() => setWho(null)}>Everyone</FilterPill>
          {people.map((p) => (
            <FilterPill key={p.id} active={who === p.id} onClick={() => setWho(p.id)}>{p.name}</FilterPill>
          ))}
        </div>
        {open && canEdit && (
          <button
            type="button"
            onClick={refresh}
            disabled={pending}
            title="Re-pull due dates & amounts from Setup into this month, then re-order"
            className="shrink-0 rounded-full border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-500 hover:border-indigo-300 hover:text-indigo-600 disabled:opacity-50"
          >
            {pending ? "↻ Syncing…" : "↻ Refresh"}
          </button>
        )}
      </div>

      {plan.hubShortfall > 0 && who == null && (
        <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          ⚠️ The treasurer is short about <b>{formatINR(plan.hubShortfall)}</b> when a payment falls due before that money has arrived — plan to carry it from last month, or expect that step to run late.
        </div>
      )}

      {shown.length === 0 ? (
        <p className="rounded-lg bg-emerald-50/60 px-3 py-3 text-center text-xs text-emerald-700">
          ✓ {whoName ? `${whoName} has nothing left to do` : "Nothing left to do"} this month.
        </p>
      ) : (
        <ol className="space-y-1.5">
          {shown.map(({ s, n }) => {
            const isTransfer = s.kind !== "bill";
            const canActTransfer = open && (isHead || currentMemberId === s.fromId || currentMemberId === s.toId);
            const canActBill = open && (canEdit || currentMemberId === s.payerId);
            const title = isTransfer ? `${s.fromName} → ${s.toName}` : `${s.payerName} → ${s.vendor}`;

            return (
              <li key={s.id} className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs ${s.done ? "bg-emerald-50/50" : s.status === "overdue" ? "bg-red-50" : s.status === "soon" ? "bg-amber-50" : "bg-slate-50"}`}>
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-slate-400">
                  {s.done ? <span className="text-emerald-600">✓</span> : n}
                </span>

                <div className="min-w-0 flex-1">
                  <div className={`flex items-center gap-1.5 ${s.done ? "text-slate-400 line-through" : "text-slate-800"}`}>
                    <span className="truncate font-medium">{title}</span>
                    <DayTag kind={s.kind} day={s.day} status={s.status ?? null} />
                  </div>
                  {s.short != null && !s.done && <div className="text-[10px] font-medium text-red-600">short {formatINR(s.short)} at this point</div>}
                </div>

                <span className={`shrink-0 tabular-nums ${s.done ? "text-slate-400 line-through" : s.status === "overdue" ? "font-semibold text-red-700" : "text-slate-700"}`}>{formatINR(s.amount)}</span>

                {/* action */}
                <span className="flex w-16 shrink-0 justify-end">
                  {isTransfer ? (
                    s.done ? (
                      canActTransfer && s.recordId != null ? (
                        <form action={unsettle}><input type="hidden" name="id" value={s.recordId} /><MiniBtn>undo</MiniBtn></form>
                      ) : null
                    ) : canActTransfer ? (
                      <form action={markSettled}>
                        <input type="hidden" name="householdId" value={householdId} />
                        <input type="hidden" name="periodId" value={periodId} />
                        <input type="hidden" name="fromMemberId" value={s.fromId} />
                        <input type="hidden" name="toMemberId" value={s.toId} />
                        <input type="hidden" name="amount" value={s.amount} />
                        <MiniBtn primary>mark done</MiniBtn>
                      </form>
                    ) : null
                  ) : s.fund && !s.done ? (
                    <PayBillModal categoryId={s.categoryId!} periodId={periodId} name={s.vendor!} bill={s.amount} fund={s.fundAvail ?? 0} generalPiggy={generalPiggy} />
                  ) : s.billId != null && canActBill ? (
                    <form action={toggleBillPaid}><input type="hidden" name="id" value={s.billId} /><MiniBtn primary={!s.done}>{s.done ? "undo" : "✓ paid"}</MiniBtn></form>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function FilterPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium ${active ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}
    >
      {children}
    </button>
  );
}

function MiniBtn({ children, primary }: { children: React.ReactNode; primary?: boolean }) {
  return (
    <button type="submit" className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium ${primary ? "bg-emerald-600 text-white hover:bg-emerald-700" : "border border-slate-200 text-slate-400 hover:border-slate-300"}`}>
      {children}
    </button>
  );
}

function DayTag({ kind, day, status }: { kind: string; day: number | null; status: "overdue" | "soon" | "normal" | null }) {
  if (kind === "transfer-out") return <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-400">after collection</span>;
  if (day == null) return null;
  const ord = `${day}${["th", "st", "nd", "rd"][((day % 100) - 20) % 10] ?? ["th", "st", "nd", "rd"][day % 100] ?? "th"}`;
  const cls = status === "overdue" ? "bg-red-100 text-red-700" : status === "soon" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-400";
  return <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>{status === "overdue" ? "was " : "by "}{ord}</span>;
}
