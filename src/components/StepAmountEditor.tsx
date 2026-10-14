"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { editManualStepAmount } from "@/app/actions";
import { formatINR } from "@/lib/format";

// Wraps a PLAIN manual step's amount in a head-only "click → type a new amount" editor. Writes through
// to the manualPlanStep row so it holds on refresh. Only for plain moves — bridge legs / bill-funding
// steps keep their amount locked to the bill/bridge (the action rejects those too).
export function StepAmountEditor({ id, amount, children }: { id: number; amount: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState(String(Math.round(amount)));
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();

  const save = () => {
    const n = Number(val.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(n) || n <= 0) { toast("Enter a valid amount", "error"); return; }
    setOpen(false);
    start(async () => {
      const fd = new FormData();
      fd.set("id", String(id));
      fd.set("amount", String(n));
      const r = await editManualStepAmount(fd);
      router.refresh();
      toast(r.ok ? `Amount set to ${formatINR(n)}` : (r.error ?? "Couldn't set the amount"), r.ok ? "success" : "error");
    });
  };

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={() => { setVal(String(Math.round(amount))); setOpen((o) => !o); }}
        disabled={pending}
        title="Edit this step's amount (head only)"
        className="inline-flex items-center gap-0.5 rounded hover:brightness-95 disabled:opacity-50"
      >
        {children}
        <span className="text-[8px] leading-none text-slate-400">✎</span>
      </button>
      {open && (
        <>
          {/* click-away backdrop */}
          <button type="button" aria-hidden onClick={() => setOpen(false)} className="fixed inset-0 z-40 cursor-default" tabIndex={-1} />
          <div className="absolute right-0 top-full z-50 mt-1 w-32 rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
            <input
              autoFocus
              inputMode="decimal"
              value={val}
              onChange={(e) => setVal(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setOpen(false); }}
              className="w-full rounded border border-slate-300 px-1.5 py-1 text-right text-xs tabular-nums focus:border-indigo-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={save}
              disabled={pending}
              className="mt-1 w-full rounded bg-indigo-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </>
      )}
    </span>
  );
}
