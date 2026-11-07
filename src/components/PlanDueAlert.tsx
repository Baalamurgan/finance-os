"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getMyPlanAlerts, type PlanAlerts } from "@/app/personal/actions";
import { formatINR } from "@/lib/format";

// Money Plan pop-up (like the card-bill alert): YOUR plan steps due today or overdue — family Money-plan
// steps and personal plan steps — once a day per view, in BOTH family and personal. In the family view the
// personal part is a count only (its detail is behind the personal PIN). "Remind me later" hides it for 3
// hours; "Dismiss for today" until tomorrow.
export function PlanDueAlert({ context }: { context: "family" | "personal" }) {
  const [data, setData] = useState<PlanAlerts | null>(null);
  const dayKey = `plan-alert:${context}:${new Date().toDateString()}`;
  const laterKey = `plan-alert-later:${context}`;

  useEffect(() => {
    try {
      if (localStorage.getItem(dayKey) === "1") return;
      if (Number(localStorage.getItem(laterKey) ?? 0) > Date.now()) return;
    } catch { /* storage blocked → still show */ }
    let alive = true;
    getMyPlanAlerts(context).then((d) => { if (alive) setData(d); }).catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!data) return null;
  const famN = data.family.length;
  const perN = data.personalCount;
  if (famN + perN === 0) return null;

  const close = (mode: "today" | "later") => {
    try {
      if (mode === "today") localStorage.setItem(dayKey, "1");
      else localStorage.setItem(laterKey, String(Date.now() + 3 * 3600 * 1000));
    } catch { /* ignore */ }
    setData(null);
  };
  const anyOverdue = data.family.some((s) => s.overdue) || data.personalOverdue;
  const total = famN + perN;
  const headline = `${total} Money Plan step${total > 1 ? "s" : ""} ${anyOverdue ? "need" : "due"} ${anyOverdue ? "action" : "today"}`;
  const Row = ({ s }: { s: { label: string; amount: number; overdue: boolean } }) => (
    <li className="flex items-start justify-between gap-3 text-sm">
      <span className="min-w-0 text-left text-slate-700">{s.label}{s.overdue && <span className="ml-1.5 rounded bg-red-100 px-1 text-[10px] font-semibold text-red-700">overdue</span>}</span>
      <span className="shrink-0 tabular-nums font-medium text-slate-800">{formatINR(s.amount)}</span>
    </li>
  );

  return (
    <div className="fixed inset-0 z-[94] flex items-end justify-center overflow-y-auto bg-black/40 sm:items-center sm:p-4" onClick={() => close("later")}>
      <div
        className={`modal-panel w-full max-w-sm rounded-t-3xl bg-white shadow-xl ring-2 sm:rounded-3xl ${anyOverdue ? "ring-red-400" : "ring-amber-300"}`}
        onClick={(e) => e.stopPropagation()}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="px-6 pt-6 text-center">
          <div className={`mx-auto grid h-14 w-14 place-items-center rounded-full text-3xl ${anyOverdue ? "bg-red-100" : "bg-amber-100"}`}>⏰</div>
          <h2 className={`mt-3 text-lg font-bold ${anyOverdue ? "text-red-700" : "text-amber-700"}`}>{headline}</h2>
        </div>
        <div className="max-h-[50vh] space-y-3 overflow-y-auto px-6 pt-3">
          {famN > 0 && (
            <div>
              <div className="mb-1 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">👪 Family</div>
              <ul className="space-y-1">{data.family.map((s, i) => <Row key={i} s={s} />)}</ul>
            </div>
          )}
          {perN > 0 && (
            <div>
              <div className="mb-1 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">🔒 Personal</div>
              {data.personal.length > 0
                ? <ul className="space-y-1">{data.personal.map((s, i) => <Row key={i} s={s} />)}</ul>
                : <p className="text-left text-sm text-slate-600">{perN} personal step{perN > 1 ? "s" : ""}{data.personalOverdue ? " (overdue)" : ""} — open Personal to see {perN > 1 ? "them" : "it"}.</p>}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2 px-6 py-5">
          {famN > 0 && (
            <Link href={`/in-hand${data.familyQ}`} onClick={() => close("today")} className="w-full rounded-xl bg-slate-900 px-4 py-3 text-center text-base font-semibold text-white hover:bg-slate-800">
              Open family Money Plan →
            </Link>
          )}
          {perN > 0 && (
            <Link href="/personal/plan" onClick={() => close("today")} className={`w-full rounded-xl px-4 py-3 text-center text-base font-semibold ${famN > 0 ? "border-2 border-emerald-600 text-emerald-700 hover:bg-emerald-50" : "bg-emerald-600 text-white hover:bg-emerald-700"}`}>
              Open my Money Plan →
            </Link>
          )}
          <div className="flex gap-2">
            <button type="button" onClick={() => close("later")} className="flex-1 rounded-xl px-4 py-2.5 text-sm font-medium text-slate-500 hover:bg-slate-100">Remind me later</button>
            <button type="button" onClick={() => close("today")} className="flex-1 rounded-xl px-4 py-2.5 text-sm font-medium text-slate-500 hover:bg-slate-100">Dismiss for today</button>
          </div>
        </div>
      </div>
    </div>
  );
}
