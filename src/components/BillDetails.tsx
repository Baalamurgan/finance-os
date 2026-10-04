"use client";

import { useEffect, useRef, useState } from "react";

type Tag = { key: string; label: string; priority: "high" | "low" };

// A tiny ⓘ that opens a tidy popover holding a row's FULL context — its tags and (for a periodic bill)
// the detail breakdown — so the row itself stays calm. Responsive: on a phone the row shows only ✓ / name
// / ⓘ and ALL tags live here; on a wide screen the high-priority tags (New, kept) sit inline, so only the
// low-priority ones (💰/🧾/🔁/💳…) need the popover (high ones are `sm:hidden` here). Closes on outside
// tap or Escape.
export function BillDetails({ name, rows, tags = [] }: { name: string; rows: { label: string; value: string }[]; tags?: Tag[] }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const t = window.setTimeout(() => document.addEventListener("click", close), 0);
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (rows.length === 0 && tags.length === 0) return null;

  return (
    <span ref={ref} className="relative shrink-0 leading-none">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        aria-label={`Details for ${name}`}
        title="Details"
        className={`flex h-[18px] w-[18px] items-center justify-center rounded-full border text-[10px] font-bold italic transition-colors ${open ? "border-teal-400 bg-teal-50 text-teal-600" : "border-slate-300 text-slate-400 hover:border-teal-400 hover:text-teal-600"}`}
      >
        i
      </button>
      {open && (
        <>
          {/* Phone: a dimmed backdrop so the panel reads as a centered modal (and taps outside close it). */}
          <span className="fixed inset-0 z-40 bg-black/25 sm:hidden" aria-hidden onClick={() => setOpen(false)} />
          {/* Phone → fixed & centered on screen; wide screen → a small popover anchored under the ⓘ. */}
          <span className="fixed left-1/2 top-1/2 z-50 block max-h-[80vh] w-[82vw] max-w-xs -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 text-left shadow-xl sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-1 sm:max-h-none sm:w-64 sm:max-w-[78vw] sm:translate-x-0 sm:translate-y-0">
          <span className="mb-2 block text-xs font-bold text-slate-800">{name}</span>
          {tags.length > 0 && (
            <span className="mb-2 flex flex-wrap gap-1 empty:hidden">
              {tags.map((t) => (
                <span
                  key={t.key}
                  className={`whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 ${t.priority === "high" ? "sm:hidden" : ""}`}
                >
                  {t.label}
                </span>
              ))}
            </span>
          )}
          {rows.length > 0 && (
            <span className="block divide-y divide-slate-100">
              {rows.map((r, i) => (
                <span key={i} className="flex items-baseline justify-between gap-3 py-1 text-[11px] first:pt-0 last:pb-0">
                  <span className="shrink-0 text-slate-400">{r.label}</span>
                  <span className="text-right font-medium text-slate-700">{r.value}</span>
                </span>
              ))}
            </span>
          )}
          </span>
        </>
      )}
    </span>
  );
}
