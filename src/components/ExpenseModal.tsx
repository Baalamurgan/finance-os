"use client";

import { useEffect, useState } from "react";
import { saveExpense } from "@/app/actions";

type Cat = { id: number; name: string };
type Mem = { id: number; name: string };

export function ExpenseModal({
  categories,
  members,
  periodId,
  initial,
  trigger,
}: {
  categories: Cat[];
  members: Mem[];
  periodId: number;
  initial?: {
    id: number;
    label: string;
    amount: number;
    categoryId: number;
    memberId: number | null;
    necessary: boolean;
  };
  trigger: "primary" | "row";
}) {
  const [open, setOpen] = useState(false);
  const [categoryId, setCategoryId] = useState<number | null>(
    initial?.categoryId ?? null
  );

  // close on Esc
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {trigger === "primary" ? (
        <button onClick={() => setOpen(true)} className="btn">
          + Add Expense
        </button>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="text-xs text-slate-400 hover:text-indigo-600"
          aria-label="Edit"
        >
          ✎
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:items-center"
          onClick={() => setOpen(false)}
        >
          <div
            className="my-auto flex max-h-[88vh] w-full max-w-md flex-col rounded-2xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* header */}
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <h2 className="text-lg font-bold text-slate-900">
                {initial ? "Edit expense" : "Add expense"}
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
              action={saveExpense}
              onSubmit={(e) => {
                // only close on a valid submit (category chosen + native validity)
                if (!categoryId || !e.currentTarget.checkValidity()) return;
                setOpen(false);
              }}
              className="flex min-h-0 flex-col"
            >
              <div className="space-y-4 overflow-y-auto px-5 py-4">
                {initial && <input type="hidden" name="id" value={initial.id} />}
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
                    defaultValue={initial?.amount}
                    placeholder="0"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-3 text-3xl font-bold tabular-nums outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                  />
                </div>

                {/* category chips */}
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

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-slate-500">Member</label>
                    <select
                      name="memberId"
                      defaultValue={initial?.memberId ?? ""}
                      className="input mt-1 w-full"
                    >
                      <option value="">Shared</option>
                      {members.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-500">Necessary?</label>
                    <select
                      name="necessary"
                      defaultValue={initial ? (initial.necessary ? "yes" : "no") : "default"}
                      className="input mt-1 w-full"
                    >
                      <option value="default">Category default</option>
                      <option value="yes">Necessary</option>
                      <option value="no">Other</option>
                    </select>
                  </div>
                </div>

                <input
                  name="label"
                  defaultValue={initial?.label}
                  placeholder="Note (optional)"
                  className="input w-full"
                />
              </div>

              {/* footer (always visible) */}
              <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md px-3 py-2 text-sm text-slate-500 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button type="submit" disabled={!categoryId} className="btn disabled:opacity-40">
                  {initial ? "Save" : "Add expense"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
