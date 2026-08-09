"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { setStepDay } from "@/app/actions";

function ordinal(day: number) {
  return `${day}${["th", "st", "nd", "rd"][((day % 100) - 20) % 10] ?? ["th", "st", "nd", "rd"][day % 100] ?? "th"}`;
}

// Wraps a step's date tag in a head-only "click → pick a day" dropdown. Picking a day writes through
// to the step's underlying row (bill/allowance/income → dueDay + pin; advance → the leg's day) so it
// holds through a refresh. Only for dated SOURCE steps — transfers/collections derive their timing.
export function StepDayEditor({ kind, id, day, children }: { kind: string; id: number; day: number | null; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();

  const pick = (d: number | null) => {
    setOpen(false);
    start(async () => {
      const fd = new FormData();
      fd.set("kind", kind);
      fd.set("id", String(id));
      if (d != null) fd.set("day", String(d));
      const r = await setStepDay(fd);
      router.refresh();
      toast(r.ok ? (d == null ? "Date cleared" : `Date set to ${ordinal(d)}`) : (r.error ?? "Couldn't set the date"), r.ok ? "success" : "error");
    });
  };

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={pending}
        title="Change this step's date (head only)"
        className="inline-flex items-center gap-0.5 rounded-full hover:brightness-95 disabled:opacity-50"
      >
        {children}
        <span className="text-[8px] leading-none text-slate-400">▾</span>
      </button>
      {open && (
        <>
          {/* click-away backdrop */}
          <button type="button" aria-hidden onClick={() => setOpen(false)} className="fixed inset-0 z-40 cursor-default" tabIndex={-1} />
          <div className="absolute left-0 top-full z-50 mt-1 w-28 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
            <div className="max-h-48 overflow-y-auto">
              <button type="button" onClick={() => pick(null)} className="block w-full rounded px-2 py-1 text-left text-[11px] text-slate-500 hover:bg-slate-50">No date</button>
              {Array.from({ length: 31 }, (_, k) => k + 1).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => pick(d)}
                  className={`block w-full rounded px-2 py-1 text-left text-[11px] hover:bg-slate-50 ${d === day ? "bg-slate-100 font-semibold text-slate-800" : "text-slate-600"}`}
                >
                  {ordinal(d)}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </span>
  );
}
