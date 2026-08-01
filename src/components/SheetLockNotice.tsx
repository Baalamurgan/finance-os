"use client";

import { useState } from "react";
import Link from "next/link";

// Shown on the Sheet once the month's settlement is marked paid. For members the sheet's
// money numbers are frozen (a "not possible" explainer modal); the head keeps editing and
// gets a shortcut to undo the settlement (which reopens the sheet for everyone).
export function SheetLockNotice({ isHead, y, m }: { isHead: boolean; y: number; m: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div
        className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${
          isHead ? "border-amber-200 bg-amber-50 text-amber-800" : "border-slate-300 bg-slate-100 text-slate-700"
        }`}
      >
        <span className="flex items-center gap-2">
          <span>🔒</span>
          <span>
            {isHead
              ? "Settlement has started for this month — the sheet is locked for members. You can still edit."
              : "Settlement has started — the sheet is locked. Money numbers can't be changed."}
          </span>
        </span>
        {isHead ? (
          <Link
            href={`/settlement?y=${y}&m=${m}`}
            className="shrink-0 rounded-md border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100"
          >
            Undo in Settlement →
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="shrink-0 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            Why?
          </button>
        )}
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-t-3xl bg-white shadow-xl sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h2 className="text-base font-bold text-slate-900">🔒 Sheet locked</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="rounded-md px-2 text-2xl leading-none text-slate-400 hover:bg-slate-100"
              >
                ✕
              </button>
            </div>
            <div className="space-y-3 px-5 py-5 text-sm text-slate-600">
              <p>
                This month&apos;s settlement has been marked paid — money has already gone to the treasurer
                based on these numbers.
              </p>
              <p>
                So the planned expenses &amp; income for this month can&apos;t be changed. You can still log
                daily spends under the Expenses tab.
              </p>
              <p className="text-xs text-slate-400">
                Need a correction? Ask the head — they can undo the settlement to reopen the sheet.
              </p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="min-h-11 w-full rounded-xl bg-slate-800 px-4 py-2.5 text-sm font-semibold text-white"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
