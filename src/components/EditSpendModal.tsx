"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { editSpendAction, type EditSpendState } from "@/app/actions";

type Mem = { id: number; name: string };

// Edit a spend in place: same card (category) and same date, just corrected data.
// A pencil on the spend row opens this; head edits anyone's, owner edits their own.
export function EditSpendModal({
  spend,
  categoryName,
  isMisc,
  subCategories,
  isHead,
  members,
}: {
  spend: { id: number; label: string; amount: number; memberId: number | null; subCategory: string | null };
  categoryName: string;
  isMisc: boolean;
  subCategories?: { name: string; icon: string }[];
  isHead: boolean;
  members?: Mem[];
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [subCategory, setSubCategory] = useState(spend.subCategory ?? "");
  const [state, formAction, pending] = useActionState<EditSpendState, FormData>(editSpendAction, { ok: false, n: 0 });
  const prevN = useRef(0);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // close once a save succeeds (n increments on each successful edit)
  useEffect(() => {
    if (state.n > prevN.current) {
      prevN.current = state.n;
      setOpen(false);
    }
  }, [state.n]);

  const needSub = isMisc && !!subCategories?.length && !subCategory;

  return (
    <>
      <button
        type="button"
        onClick={() => { setSubCategory(spend.subCategory ?? ""); setOpen(true); }}
        aria-label="Edit spend"
        className="flex h-9 w-9 items-center justify-center rounded-lg text-base text-slate-300 hover:bg-indigo-50 hover:text-indigo-600"
      >
        ✎
      </button>

      {open && mounted &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/40 sm:items-center sm:p-4"
            onClick={() => setOpen(false)}
          >
            <div
              className="flex max-h-[92vh] w-full max-w-md flex-col rounded-t-3xl bg-white shadow-xl sm:my-auto sm:rounded-2xl"
              onClick={(e) => e.stopPropagation()}
              style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
            >
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                <h2 className="text-xl font-bold text-slate-900">
                  Edit spend<span className="text-indigo-600"> · {categoryName}</span>
                </h2>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="-mr-2 rounded-lg px-3 py-2 text-2xl leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>

              <form action={formAction} className="flex min-h-0 flex-col">
                <div className="space-y-5 overflow-y-auto px-5 py-5">
                  <input type="hidden" name="id" value={spend.id} />

                  <div>
                    <label className="text-sm font-medium text-slate-600">Amount (₹)</label>
                    <input
                      name="amount"
                      type="number"
                      step="1"
                      min="0"
                      inputMode="numeric"
                      required
                      defaultValue={spend.amount}
                      className="mt-1.5 w-full rounded-xl border-2 border-slate-300 px-4 py-3 text-4xl font-bold tabular-nums outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                    />
                  </div>

                  {isMisc && subCategories && (
                    <div>
                      <label className="text-sm font-medium text-slate-600">
                        Kind of spend <span className="text-red-500">*</span>
                      </label>
                      <select
                        name="subCategory"
                        required
                        value={subCategory}
                        onChange={(e) => setSubCategory(e.target.value)}
                        className="mt-1.5 w-full rounded-xl border-2 border-slate-300 px-4 py-3 text-base outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                      >
                        <option value="" disabled>Pick a kind…</option>
                        {subCategories.map((s) => (
                          <option key={s.name} value={s.name}>{s.icon} {s.name}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div>
                    <label className="text-sm font-medium text-slate-600">What was bought</label>
                    <input
                      name="label"
                      required
                      defaultValue={spend.label}
                      className="mt-1.5 w-full rounded-xl border-2 border-slate-300 px-4 py-3 text-lg outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                    />
                  </div>

                  {isHead && members && members.length > 0 && (
                    <div>
                      <label className="text-sm font-medium text-slate-600">Who spent</label>
                      <select
                        name="memberId"
                        defaultValue={spend.memberId ?? ""}
                        className="mt-1.5 w-full rounded-xl border-2 border-slate-300 px-4 py-3 text-base outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                      >
                        <option value="">Shared</option>
                        {members.map((m) => (
                          <option key={m.id} value={m.id}>{m.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-3 border-t border-slate-100 px-5 py-4">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="min-h-12 flex-1 rounded-xl border-2 border-slate-200 px-4 py-3 text-base font-medium text-slate-600 active:bg-slate-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={needSub || pending}
                    className="min-h-12 flex-1 rounded-xl bg-indigo-600 px-4 py-3 text-base font-semibold text-white shadow-sm active:bg-indigo-800 disabled:opacity-40"
                  >
                    {pending ? "Saving…" : "Save changes"}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
