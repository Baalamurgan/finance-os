"use client";

import { useEffect, useRef, useState } from "react";

// A compact "⋯" kebab menu for a row, replacing the tiny adjacent edit/delete
// icons (too small + too close on phones). Opens a popover with an Edit slot
// (e.g. an ExpenseModal trigger="menuitem") and a two-tap-confirm Delete.
export function RowActions({
  id,
  deleteAction,
  children,
}: {
  id: number;
  deleteAction: (formData: FormData) => void;
  children?: React.ReactNode; // edit menu item
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setConfirming(false);
      }
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Actions"
        className="flex h-9 w-9 items-center justify-center rounded-lg text-lg leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-700"
      >
        ⋯
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-1 w-40 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
          {/* Edit slot (closes the menu when chosen) */}
          <div onClick={() => setOpen(false)}>{children}</div>

          {!confirming ? (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="block w-full px-4 py-3 text-left text-sm font-medium text-red-600 hover:bg-red-50"
            >
              Delete
            </button>
          ) : (
            <form action={deleteAction} className="flex items-center justify-between gap-2 px-4 py-2.5">
              <input type="hidden" name="id" value={id} />
              <span className="text-xs text-slate-500">Delete?</span>
              <span className="flex gap-1.5">
                <button
                  type="submit"
                  className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-semibold text-white active:bg-red-700"
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600"
                >
                  No
                </button>
              </span>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
