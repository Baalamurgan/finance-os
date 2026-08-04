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
  showDueDay = false,
  defaultRepeat = true,
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
    dueDay?: number | null;
  };
  trigger?: "primary" | "row" | "menuitem" | "sheet";
  controlledOpen?: boolean; // when provided, parent controls open state
  onOpenChange?: (v: boolean) => void;
  hideTrigger?: boolean; // render no trigger (parent opens via controlledOpen)
  balance?: number; // current sheet balance — new expense can't exceed it (create only)
  sheetLabel?: string; // text for the "sheet" trigger button
  newCategoryDefaultSection?: string; // preselected section when creating a new category
  showDueDay?: boolean; // show an optional "due day" field (drives Money-plan ordering)
  defaultRepeat?: boolean; // default state of the "repeat every month" checkbox (create only)
}) {
  const [openState, setOpenState] = useState(false);
  const open = controlledOpen ?? openState;
  const setOpen = onOpenChange ?? setOpenState;
  const [categoryId, setCategoryId] = useState<number | null>(
    initial?.categoryId ?? null
  );
  const [amount, setAmount] = useState(initial?.amount != null ? String(initial.amount) : "");
  const [newCat, setNewCat] = useState(false); // creating a brand-new category inline
  const [picks, setPicks] = useState<Record<number, number>>({}); // funder memberId → amount they front
  const [paybackOverride, setPaybackOverride] = useState(""); // blank = auto (earliest day borrower can repay)
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
  const hasSources = !state.ok && !!state.sources && state.sources.length > 0;
  // Multi-funder split: the user can spread a shortfall across several people who hold spare cash.
  const shortfallAmt = state.shortfall?.amount ?? 0;
  const coveredTotal = Math.round(Object.values(picks).reduce((s, v) => s + (v || 0), 0) * 100) / 100;
  const funding = Object.keys(picks).length > 0;
  const fullyCovered = coveredTotal >= shortfallAmt - 0.5;
  const toggleFunder = (memberId: number, spare: number) =>
    setPicks((p) => {
      const next = { ...p };
      if (memberId in next) { delete next[memberId]; return next; }
      const covered = Object.values(next).reduce((s, v) => s + (v || 0), 0);
      next[memberId] = Math.round(Math.min(spare, Math.max(0, shortfallAmt - covered)) * 100) / 100; // prefill: cover the rest, up to their spare
      return next;
    });
  const setFunderAmount = (memberId: number, spare: number, val: string) =>
    setPicks((p) => ({ ...p, [memberId]: Math.max(0, Math.min(spare, Number(val) || 0)) }));

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
      setPicks({});
      setPaybackOverride("");
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

                {/* optional due day — drives Money-plan ordering / overdue tags */}
                {showDueDay && (
                  <div>
                    <label className="text-xs font-medium text-slate-500">Due day (optional)</label>
                    <input
                      name="dueDay"
                      type="number"
                      min="1"
                      max="31"
                      inputMode="numeric"
                      defaultValue={initial?.dueDay ?? ""}
                      placeholder="e.g. 15"
                      className="input mt-1 w-full"
                    />
                    <p className="mt-1 text-[11px] text-slate-400">
                      Day of the month it&apos;s due — leave blank for no date (it sorts last in the Money plan).
                    </p>
                  </div>
                )}

                {/* recurring vs one-time — create mode only */}
                {!initial && (
                  <label className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
                    <input type="checkbox" name="repeat" defaultChecked={defaultRepeat} className="h-4 w-4 accent-indigo-600" />
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
                <button type="submit" disabled={(!categoryId && !newCat) || overBalance || pending || (hasSources && !fullyCovered)} className="btn disabled:opacity-40">
                  {pending ? "Saving…" : funding ? "Fund & add" : initial ? "Save" : "Add expense"}
                </button>
              </div>
              {/* When a save is blocked for a shortfall, offer to fund it from people holding spare cash —
                  one or several (split a big shortfall across funders). Each becomes a front + payback loan. */}
              {hasSources && state.shortfall && (
                <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
                  <p className="font-medium">⚠ {state.shortfall.toName} would be short {formatINR(state.shortfall.amount)}{state.shortfall.day != null ? ` on day ${state.shortfall.day}` : ""}.</p>
                  <p className="mt-1 text-amber-700">Front it from people holding spare cash — pick one, or split across several. They pay {state.shortfall.toName} just before this step, and get repaid once {state.shortfall.toName}’s income lands.</p>
                  <div className="mt-2 space-y-1.5">
                    {state.sources!.map((src) => {
                      const on = src.memberId in picks;
                      return (
                        <div key={src.memberId} className="flex items-center gap-2">
                          <label className="flex flex-1 items-center gap-2 cursor-pointer">
                            <input type="checkbox" checked={on} onChange={() => toggleFunder(src.memberId, src.spare)} className="accent-amber-600" />
                            <span className={on ? "font-medium" : ""}>{src.name}</span>
                            <span className="text-amber-600">— {formatINR(src.spare)} spare</span>
                          </label>
                          {on && (
                            <input
                              type="number" inputMode="numeric" min={0} max={src.spare} value={picks[src.memberId] ?? 0}
                              onChange={(e) => setFunderAmount(src.memberId, src.spare, e.target.value)}
                              className="input w-28 py-1 text-right text-sm"
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <p className="mt-2 font-medium">
                    Covered {formatINR(coveredTotal)} of {formatINR(shortfallAmt)}
                    {fullyCovered ? " ✓" : ` — ${formatINR(Math.max(0, Math.round((shortfallAmt - coveredTotal) * 100) / 100))} still needed`}
                  </p>
                  <label className="mt-2 flex items-center gap-2 text-amber-700">
                    <span>Repaid on day</span>
                    <input
                      type="number" inputMode="numeric" min={1} max={31} placeholder="auto" value={paybackOverride}
                      onChange={(e) => setPaybackOverride(e.target.value)}
                      className="input w-20 py-1 text-center text-sm"
                    />
                    <span className="text-amber-500">(blank = when their income lands)</span>
                  </label>
                  {funding && (
                    <>
                      <input type="hidden" name="funders" value={JSON.stringify(Object.entries(picks).filter(([, a]) => a > 0).map(([m, a]) => ({ memberId: Number(m), amount: a })))} />
                      {paybackOverride && <input type="hidden" name="paybackDayOverride" value={paybackOverride} />}
                    </>
                  )}
                </div>
              )}
              {!state.ok && state.error && !hasSources && (
                <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700">⚠ {state.error}</p>
              )}
            </form>
          </div>
        </div>
      )}
    </>
  );
}
