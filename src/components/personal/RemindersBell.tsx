"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { getMyCardReminders, type CardReminderItem } from "@/app/personal/actions";
import { formatINR } from "@/lib/format";

// Bell in the personal header: a reminder inbox. Lists every active card reminder (the same
// ones that pop up), so you can revisit them after dismissing the popup. An item clears once
// you mark that bill paid — derived from live dues, so nothing is stored.
export function RemindersBell() {
  const [items, setItems] = useState<CardReminderItem[] | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    getMyCardReminders().then((r) => alive && setItems(r)).catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  const count = items?.length ?? 0;
  const fmtDue = (r: CardReminderItem) =>
    r.overdue ? `overdue (was due ${fmtDate(r.dueISO)})` : r.daysUntilDue === 0 ? "due today" : `due in ${r.daysUntilDue}d (${fmtDate(r.dueISO)})`;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Reminders"
        className="relative grid h-9 w-9 place-items-center rounded-full border border-emerald-200 bg-white text-lg hover:bg-emerald-100"
      >
        🔔
        {count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 max-w-[85vw] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-800">Reminders</div>
          {count === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-400">Nothing due right now. 🎉</p>
          ) : (
            <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
              {items!.map((r) => (
                <li key={r.cardId}>
                  <Link href={`/personal/finance/${r.cardId}`} onClick={() => setOpen(false)} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.color }} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-slate-900">{r.cardName}</div>
                      <div className={`text-xs ${r.overdue ? "text-red-600" : "text-slate-500"}`}>{fmtDue(r)}</div>
                    </div>
                    {r.amount > 0 && <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-700">{formatINR(r.amount)}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400">Open a card to pay — it clears here once marked paid.</p>
        </div>
      )}
    </div>
  );
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
