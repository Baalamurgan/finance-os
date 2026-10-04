"use client";

import { useEffect, useRef, useState } from "react";

// A tiny ⓘ that opens a tidy popover with the FULL details of a periodic / fund bill — recurrence, due
// date, funding, this-month vs full amount, incentive, penalty, paid-with-card. Keeps the Sheet row calm
// (only the actionable pills live there); the depth is one tap away. Closes on outside tap or Escape.
export function BillDetails({ name, rows }: { name: string; rows: { label: string; value: string }[] }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    // defer so the opening tap itself doesn't immediately close it
    const t = window.setTimeout(() => document.addEventListener("click", close), 0);
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (rows.length === 0) return null;

  return (
    <span ref={ref} className="relative shrink-0 leading-none">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        aria-label={`Details for ${name}`}
        title="Bill details"
        className={`flex h-[18px] w-[18px] items-center justify-center rounded-full border text-[10px] font-bold italic transition-colors ${open ? "border-teal-400 bg-teal-50 text-teal-600" : "border-slate-300 text-slate-400 hover:border-teal-400 hover:text-teal-600"}`}
      >
        i
      </button>
      {open && (
        <span className="absolute right-0 top-full z-40 mt-1 block w-64 max-w-[78vw] rounded-xl border border-slate-200 bg-white p-3 text-left shadow-xl">
          <span className="mb-2 block text-xs font-bold text-slate-800">{name}</span>
          <span className="block divide-y divide-slate-100">
            {rows.map((r, i) => (
              <span key={i} className="flex items-baseline justify-between gap-3 py-1 text-[11px] first:pt-0 last:pb-0">
                <span className="shrink-0 text-slate-400">{r.label}</span>
                <span className="text-right font-medium text-slate-700">{r.value}</span>
              </span>
            ))}
          </span>
        </span>
      )}
    </span>
  );
}
