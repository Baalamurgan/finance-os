"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { getMyCardReminders } from "@/app/personal/actions";
import { getMyBillReminders } from "@/app/actions";
import { formatINR } from "@/lib/format";

// Bell reminder inbox — used in BOTH shells. Personal shows credit-card bill reminders;
// family shows household bill reminders (the ones you're on the hook for). Items are derived
// from live dues, so an item clears automatically once its bill is marked paid — nothing stored.
type Item = { key: string; title: string; dueISO: string; daysUntilDue: number; overdue: boolean; amount: number; href: string; dot?: string };

async function loadItems(context: "family" | "personal"): Promise<Item[]> {
  if (context === "personal") {
    const rows = await getMyCardReminders();
    return rows.map((r) => ({ key: `c${r.cardId}`, title: r.cardName, dueISO: r.dueISO, daysUntilDue: r.daysUntilDue, overdue: r.overdue, amount: r.amount, href: `/personal/finance/${r.cardId}`, dot: r.color }));
  }
  const rows = await getMyBillReminders();
  return rows.map((r) => ({ key: `b${r.categoryId}`, title: r.name, dueISO: r.dueISO, daysUntilDue: r.daysUntilDue, overdue: r.overdue, amount: r.amount ?? 0, href: "/in-hand" }));
}

export function RemindersBell({ context }: { context: "family" | "personal" }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const accent = context === "personal" ? "emerald" : "indigo";

  useEffect(() => {
    let alive = true;
    loadItems(context).then((r) => alive && setItems(r)).catch(() => {});
    return () => { alive = false; };
  }, [context]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  const count = items?.length ?? 0;
  const fmtDue = (r: Item) =>
    r.overdue ? `overdue (was due ${fmtDate(r.dueISO)})` : r.daysUntilDue === 0 ? "due today" : `due in ${r.daysUntilDue}d (${fmtDate(r.dueISO)})`;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Reminders"
        className={`relative grid h-9 w-9 place-items-center rounded-full border text-lg ${accent === "emerald" ? "border-emerald-200 bg-white hover:bg-emerald-100" : "border-slate-200 bg-white hover:bg-slate-100"}`}
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
                <li key={r.key}>
                  <Link href={r.href} onClick={() => setOpen(false)} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.dot ?? "#f59e0b" }} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-slate-900">{r.title}</div>
                      <div className={`text-xs ${r.overdue ? "text-red-600" : "text-slate-500"}`}>{fmtDue(r)}</div>
                    </div>
                    {r.amount > 0 && <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-700">{formatINR(r.amount)}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400">
            {context === "personal" ? "Open a card to pay — it clears here once marked paid." : "Open In-Hand to pay — it clears here once marked paid."}
          </p>
        </div>
      )}
    </div>
  );
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
