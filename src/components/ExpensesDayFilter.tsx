"use client";

import { useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { startNavProgress } from "@/components/NavProgress";

// "📅 Day" filter on Spends: pick a day of the month to see only that day's spends (?day=YYYY-MM-DD).
// URL-driven like the member filter, so it keeps the month / sort / member and works with back/forward.
export function ExpensesDayFilter({ day, year, month }: { day: string | null; year: number; month: number }) {
  const router = useRouter();
  const params = useSearchParams();
  const ref = useRef<HTMLInputElement>(null);
  const pad = (n: number) => String(n).padStart(2, "0");
  const min = `${year}-${pad(month)}-01`;
  const max = `${year}-${pad(month)}-${pad(new Date(Date.UTC(year, month, 0)).getUTCDate())}`;

  const set = (d: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (d) next.set("day", d);
    else next.delete("day");
    startNavProgress();
    router.replace(`/expenses?${next.toString()}`, { scroll: false });
  };

  const label = day ? new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }) : "Day";
  return (
    <span className="relative inline-flex items-center">
      <button
        type="button"
        onClick={() => { const el = ref.current; if (!el) return; try { el.showPicker(); } catch { el.focus(); el.click(); } }}
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium shadow-sm ${day ? "border-sky-300 bg-sky-50 text-sky-800" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
        aria-label={day ? `Showing ${label} — change day` : "Filter by day"}
      >
        📅 {label}
      </button>
      {day && (
        <button type="button" onClick={() => set(null)} aria-label="Clear day filter" className="ml-1 grid h-6 w-6 place-items-center rounded-full text-xs text-slate-400 hover:bg-slate-100">✕</button>
      )}
      {/* the native date picker, opened by the button (kept in the layout so showPicker() can anchor to it) */}
      <input
        ref={ref}
        type="date"
        min={min}
        max={max}
        value={day ?? ""}
        onChange={(e) => e.target.value && set(e.target.value)}
        className="pointer-events-none absolute bottom-0 left-0 h-0 w-0 opacity-0"
        tabIndex={-1}
        aria-hidden
      />
    </span>
  );
}
