"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { saveExpenseAction, type SaveState } from "@/app/actions";
import { formatINR } from "@/lib/format";

type Cat = { id: number; name: string; section?: string };
type Mem = { id: number; name: string };

const SECTION_ORDER = ["Loans", "Chits", "Monthly", "Misc"] as const;
const SECTION_LABEL: Record<string, string> = {
  Loans: "Loans", Chits: "Chits", Monthly: "Monthly", Misc: "Miscellaneous",
};

export function ExpenseModal({
  categories,
  members,
  periodId,
  initial,
  trigger = "row",
  controlledOpen,
  onOpenChange,
  hideTrigger,
  balance,
  sheetLabel = "+ Add expense",
  newCategoryDefaultSection = "Monthly",
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
  trigger?: "primary" | "row" | "menuitem" | "sheet";
  controlledOpen?: boolean; // when provided, parent controls open state
  onOpenChange?: (v: boolean) => void;
  hideTrigger?: boolean; // render no trigger (parent opens via controlledOpen)
  balance?: number; // current sheet balance — new expense can't exceed it (create only)
  sheetLabel?: string; // text for the "sheet" trigger button
  newCategoryDefaultSection?: string; // preselected section when creating a new category
}) {
  const [openState, setOpenState] = useState(false);
  const open = controlledOpen ?? openState;
  const setOpen = onOpenChange ?? setOpenState;
  const [categoryId, setCategoryId] = useState<number | null>(
    initial?.categoryId ?? null
  );
  const [amount, setAmount] = useState(initial?.amount != null ? String(initial.amount) : "");
  const [newCat, setNewCat] = useState(false); // creating a brand-new category inline
  const noteRef = useRef<HTMLInputElement>(null);
  const prevN = useRef(0);

  const [state, formAction, pending] = useActionState<SaveState, FormData>(saveExpenseAction, {
    ok: false,
    n: 0,
  });

  // balance cap applies only when adding a new expense (create) and a balance is known
  const capped = !initial && typeof balance === "number";
  const amountNum = Number(amount) || 0;
  const overBalance = capped && amountNum > balance!;

  const sections = SECTION_ORDER.filter((sec) => categories.some((c) => c.section === sec));
  const grouped = sections.length > 0;

  // close on Esc
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // close + reset only on a real successful save
  useEffect(() => {
    if (state.n > prevN.current) {
      prevN.current = state.n;
      setOpen(false);
      if (!initial) {
        setAmount("");
        setCategoryId(null);
        setNewCat(false);
      }
    }
  }, [state.n]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {hideTrigger ? null : trigger === "sheet" ? (
        <button
          onClick={() => setOpen(true)}
          className="w-full rounded-lg border border-dashed border-red-300 px-3 py-2 text-left text-sm font-medium text-red-700 hover:bg-red-50"
        >
          {sheetLabel}
          <span className="block text-[11px] font-normal text-slate-400">
            affects the month&apos;s balance
          </span>
        </button>
      ) : trigger === "primary" ? (
        <button onClick={() => setOpen(true)} className="btn">
          + Add Expense
        </button>
      ) : trigger === "menuitem" ? (
        <button
          onClick={() => setOpen(true)}
          className="block w-full px-4 py-3 text-left text-sm text-slate-700 hover:bg-slate-50"
        >
          Edit
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
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
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
              action={formAction}
              onSubmit={(e) => {
                // client validation — block (don't run the action) until valid
                if (!categoryId && !newCat) {
                  e.preventDefault();
                  alert("Pick a category (or add a new one).");
                  return;
                }
                if (!noteRef.current?.value.trim()) {
                  e.preventDefault();
                  noteRef.current?.focus();
                  return;
                }
                if (overBalance) {
                  e.preventDefault();
                  alert(`Only ${formatINR(balance!)} is available in this month's balance.`);
                  return;
                }
                // valid → let the server action run; the modal closes on success (effect)
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
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0"
                    className={`mt-1 w-full rounded-lg border px-3 py-3 text-3xl font-bold tabular-nums outline-none focus:ring-2 ${
                      overBalance
                        ? "border-red-400 focus:border-red-400 focus:ring-red-100"
                        : "border-slate-300 focus:border-indigo-400 focus:ring-indigo-100"
                    }`}
                  />
                  {capped && (
                    <p className={`mt-1 text-xs ${overBalance ? "font-medium text-red-600" : "text-slate-400"}`}>
                      {overBalance ? "More than available — " : "Balance available: "}
                      {formatINR(balance!)}
                    </p>
                  )}
                </div>

                {/* category — grouped dropdown, with an inline "new category" option */}
                <div>
                  <label className="text-xs font-medium text-slate-500">Category</label>
                  <select
                    value={newCat ? "new" : categoryId ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "new") {
                        setNewCat(true);
                        setCategoryId(null);
                      } else {
                        setNewCat(false);
                        setCategoryId(v ? Number(v) : null);
                      }
                    }}
                    className="input mt-1 w-full"
                  >
                    <option value="">Select category…</option>
                    {grouped
                      ? sections.map((sec) => (
                          <optgroup key={sec} label={SECTION_LABEL[sec]}>
                            {categories.filter((c) => c.section === sec).map((cat) => (
                              <option key={cat.id} value={cat.id}>{cat.name}</option>
                            ))}
                          </optgroup>
                        ))
                      : categories.map((cat) => (
                          <option key={cat.id} value={cat.id}>{cat.name}</option>
                        ))}
                    <option value="new">➕ New category…</option>
                  </select>

                  {newCat && (
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <input
                        name="newCategoryName"
                        required
                        autoFocus
                        placeholder="New category (e.g. YouTube)"
                        className="input"
                      />
                      <select name="newCategorySection" defaultValue={newCategoryDefaultSection} className="input">
                        <option value="Loans">Loans</option>
                        <option value="Chits">Chits</option>
                        <option value="Monthly">Monthly</option>
                        <option value="Misc">Miscellaneous</option>
                      </select>
                    </div>
                  )}
                </div>

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
                  <label className="text-xs font-medium text-slate-500">Note (required)</label>
                  <input
                    ref={noteRef}
                    name="label"
                    required
                    defaultValue={initial?.label}
                    placeholder="e.g. Jewel loan extra principal, Health insurance"
                    className="input mt-1 w-full"
                  />
                </div>

                {/* recurring vs one-time — create mode only */}
                {!initial && (
                  <label className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
                    <input type="checkbox" name="repeat" defaultChecked className="h-4 w-4 accent-indigo-600" />
                    Repeat every month
                    <span className="text-xs text-slate-400">(uncheck = only this month)</span>
                  </label>
                )}
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
                <button type="submit" disabled={(!categoryId && !newCat) || overBalance || pending} className="btn disabled:opacity-40">
                  {pending ? "Saving…" : initial ? "Save" : "Add expense"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
