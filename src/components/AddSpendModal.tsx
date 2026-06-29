"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { addSpend } from "@/app/actions";

type Cat = { id: number; name: string };

export function AddSpendModal({
  periodId,
  trigger,
  fixedCategory,
  categories,
}: {
  periodId: number;
  trigger: "primary" | "card";
  fixedCategory?: Cat; // card mode: category locked
  categories?: Cat[]; // picker mode: choose a category
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [categoryId, setCategoryId] = useState<number | null>(fixedCategory?.id ?? null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Render the overlay at <body> via a portal so an ancestor's backdrop-blur
  // (the sticky header) doesn't trap `position: fixed` and clip the modal.
  return (
    <>
      {trigger === "primary" ? (
        <button onClick={() => setOpen(true)} className="btn">
          + Add Spend
        </button>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="rounded-md px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50"
        >
          + Add spend
        </button>
      )}

      {open &&
        mounted &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:items-center"
            onClick={() => setOpen(false)}
          >
          <div
            className="my-auto flex max-h-[88vh] w-full max-w-md flex-col rounded-2xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <h2 className="text-lg font-bold text-slate-900">
                Add spend
                {fixedCategory && <span className="text-indigo-600"> · {fixedCategory.name}</span>}
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md px-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <form
              action={addSpend}
              onSubmit={(e) => {
                if (!categoryId || !e.currentTarget.checkValidity()) return;
                setOpen(false);
              }}
              className="flex min-h-0 flex-col"
            >
              <div className="space-y-4 overflow-y-auto px-5 py-4">
                <input type="hidden" name="periodId" value={periodId} />
                <input type="hidden" name="categoryId" value={categoryId ?? ""} />

                {/* big amount */}
                <div>
                  <label className="text-xs font-medium text-slate-500">Amount (₹)</label>
                  <input
                    name="amount"
                    type="number"
                    step="0.01"
                    inputMode="decimal"
                    autoFocus
                    required
                    placeholder="0"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-3 text-3xl font-bold tabular-nums outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                  />
                </div>

                {/* category chips (picker mode only) */}
                {!fixedCategory && categories && (
                  <div>
                    <label className="text-xs font-medium text-slate-500">Category</label>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {categories.map((cat) => (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() => setCategoryId(cat.id)}
                          className={`rounded-full border px-3 py-1.5 text-sm transition ${
                            categoryId === cat.id
                              ? "border-indigo-500 bg-indigo-50 font-medium text-indigo-700"
                              : "border-slate-300 text-slate-600 hover:border-slate-400"
                          }`}
                        >
                          {cat.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <label className="text-xs font-medium text-slate-500">What was bought</label>
                  <input
                    name="label"
                    required
                    placeholder="e.g. Tomatoes, Chicken, Petrol"
                    className="input mt-1 w-full"
                  />
                </div>

                {/* Receipt photo upload deferred for v1 (needs Supabase Storage on
                    serverless). Re-enable the file input once cloud storage is wired. */}
              </div>

              <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md px-3 py-2 text-sm text-slate-500 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button type="submit" disabled={!categoryId} className="btn disabled:opacity-40">
                  Add spend
                </button>
              </div>
            </form>
          </div>
          </div>,
          document.body
        )}
    </>
  );
}
