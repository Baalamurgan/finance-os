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
  // These were uncontrolled (defaultValue). React 19 resets uncontrolled fields after a form action
  // returns — so when the save came back reporting a shortfall (not an actual save), the member / note /
  // due-day / repeat / new-category inputs were wiped. Controlling them here persists what the user
  // typed across that re-render, so the form only clears once the save truly succeeds.
  const [memberId, setMemberId] = useState(initial?.memberId != null ? String(initial.memberId) : "");
  const [label, setLabel] = useState(initial?.label ?? "");
  const [dueDay, setDueDay] = useState(initial?.dueDay != null ? String(initial.dueDay) : "");
  const [repeat, setRepeat] = useState(defaultRepeat);
  const [newCatName, setNewCatName] = useState("");
  const [newCatSection, setNewCatSection] = useState(newCategoryDefaultSection);
  // Pool-funded misc: for a misc expense assigned to a member, pay the FULL amount from the pool
  // (treasurer → member, no payback) instead of the member self-funding it. Only offered for the misc
  // bucket + an actual member (not Shared), on create.
  const [poolFund, setPoolFund] = useState(false);
  // Two-step variant: also add a separate "member → vendor" payment step (independently tickable).
  const [poolBill, setPoolBill] = useState(false);
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
  // Offer pool-funding only for the misc bucket assigned to a real member, on create.
  const selectedCat = categoryId != null ? categories.find((c) => c.id === categoryId) : undefined;
  const isMiscCat = newCat ? newCatSection === "Misc" : selectedCat?.section === "Misc";
  const showPool = !initial && isMiscCat && memberId !== "";
  const memberLabel = members.find((m) => String(m.id) === memberId)?.name ?? "";
  const fullyCovered = coveredTotal >= shortfallAmt - 0.5;
  const toggleFunder = (memberId: number, spare: number) => {
    setPoolFund(false); setPoolBill(false); // peer advance and pool-funding are mutually exclusive
    setPicks((p) => {
      const next = { ...p };
      if (memberId in next) { delete next[memberId]; return next; }
      const covered = Object.values(next).reduce((s, v) => s + (v || 0), 0);
      next[memberId] = Math.round(Math.min(spare, Math.max(0, shortfallAmt - covered)) * 100) / 100; // prefill: cover the rest, up to their spare
      return next;
    });
  };
  // Picking the treasurer in the shortfall list = pool-fund the FULL amount (no payback), not an advance
  // of the gap. Reuses the poolFund path; clears any peer picks (the pool covers the whole expense).
  const toggleTreasurerPool = () =>
    setPoolFund((on) => { const next = !on; if (next) setPicks({}); else setPoolBill(false); return next; });
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
      if (!initial) {
        setAmount("");
        setCategoryId(null);
        setNewCat(false);
        setMemberId("");
        setLabel("");
        setDueDay("");
        setRepeat(defaultRepeat);
        setNewCatName("");
        setNewCatSection(newCategoryDefaultSection);
        setPoolFund(false);
        setPoolBill(false);
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
                if (!label.trim()) {
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
                        value={newCatName}
                        onChange={(e) => setNewCatName(e.target.value)}
                        placeholder="New category (e.g. YouTube)"
                        className="input"
                      />
                      <select name="newCategorySection" value={newCatSection} onChange={(e) => setNewCatSection(e.target.value)} className="input">
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
                    value={memberId}
                    onChange={(e) => setMemberId(e.target.value)}
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
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
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
                      value={dueDay}
                      onChange={(e) => setDueDay(e.target.value)}
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
                    <input type="checkbox" name="repeat" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} className="h-4 w-4 accent-indigo-600" />
                    Repeat every month
                    <span className="text-xs text-slate-400">(uncheck = only this month)</span>
                  </label>
                )}

                {/* Pool-funded misc: treasurer sends the full amount to this member (family money, no
                    repayment) instead of them covering it from their own cash. */}
                {showPool && !hasSources && (
                  <div className="rounded-lg bg-amber-50 px-3 py-2">
                    <label className="flex items-start gap-2 text-sm text-amber-800">
                      <input type="checkbox" name="poolFund" checked={poolFund} onChange={(e) => { setPoolFund(e.target.checked); if (!e.target.checked) setPoolBill(false); }} className="mt-0.5 h-4 w-4 accent-amber-600" />
                      <span>
                        Pay the full amount from the pool
                        <span className="mt-0.5 block text-xs font-normal text-amber-600">
                          The treasurer sends the whole ₹{amount || "0"} to this member — family money, no repayment. Shows as a treasurer → member step in the Money Plan.
                        </span>
                      </span>
                    </label>
                    {/* Two-step variant: hub → member, THEN member → vendor. Only offered once pool-funding. */}
                    {poolFund && (
                      <label className="mt-2 flex items-start gap-2 border-t border-amber-200 pt-2 text-sm text-amber-800">
                        <input type="checkbox" name="poolBill" checked={poolBill} onChange={(e) => setPoolBill(e.target.checked)} className="mt-0.5 h-4 w-4 accent-amber-600" />
                        <span>
                          Also add a separate “{memberLabel || "member"} → vendor” payment step
                          <span className="mt-0.5 block text-xs font-normal text-amber-600">
                            Two steps in the Money Plan, ticked independently: the treasurer sends the money, then {memberLabel || "the member"} pays the vendor.
                          </span>
                        </span>
                      </label>
                    )}
                  </div>
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
                <button type="submit" disabled={(!categoryId && !newCat) || overBalance || pending || (hasSources && !fullyCovered && !poolFund)} className="btn disabled:opacity-40">
                  {pending ? "Saving…" : funding ? "Fund & add" : showPool && poolFund ? (poolBill ? "Add (pool-funded, 2-step)" : "Add (pool-funded)") : initial ? "Save" : "Add expense"}
                </button>
              </div>
              {/* When a save is blocked for a shortfall, offer to fund it from people holding spare cash —
                  one or several (split a big shortfall across funders). Each becomes a front + payback loan. */}
              {hasSources && state.shortfall && (
                <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
                  <p className="font-medium">⚠ {state.shortfall.toName} would be short {formatINR(state.shortfall.amount)}{state.shortfall.day != null ? ` on day ${state.shortfall.day}` : ""}.</p>
                  <p className="mt-1 text-amber-700">Cover it from the pool (treasurer pays the full amount, no payback), or front the gap from people holding spare cash — pick one, or split across several.</p>
                  <div className="mt-2 space-y-1.5">
                    {state.sources!.map((src) => {
                      // The treasurer = the POOL option: pay the FULL expense from the pool (no payback),
                      // not an advance of the gap. Selecting it flips poolFund (and reveals the 2-step box).
                      if (src.isTreasurer) {
                        return (
                          <div key={`pool-${src.memberId}`} className="rounded-md bg-amber-100/60 px-2 py-1.5">
                            <label className="flex items-start gap-2 cursor-pointer">
                              <input type="checkbox" name="poolFund" checked={poolFund} onChange={toggleTreasurerPool} className="mt-0.5 accent-amber-600" />
                              <span>
                                <span className={poolFund ? "font-semibold" : "font-medium"}>🏦 {src.name} — pay the full {formatINR(amount ? Number(amount) : src.spare)} from the pool</span>
                                <span className="mt-0.5 block font-normal text-amber-600">Family money, no repayment. Shows as a treasurer → {state.shortfall!.toName} step in the Money Plan.</span>
                              </span>
                            </label>
                            {poolFund && (
                              <label className="mt-1.5 ml-6 flex items-start gap-2 cursor-pointer border-t border-amber-200 pt-1.5">
                                <input type="checkbox" name="poolBill" checked={poolBill} onChange={(e) => setPoolBill(e.target.checked)} className="mt-0.5 accent-amber-600" />
                                <span>
                                  Also add a separate “{state.shortfall!.toName} → vendor” payment step
                                  <span className="mt-0.5 block font-normal text-amber-600">Two steps, ticked independently: the treasurer sends the money, then {state.shortfall!.toName} pays the vendor.</span>
                                </span>
                              </label>
                            )}
                          </div>
                        );
                      }
                      const on = src.memberId in picks;
                      return (
                        <div key={src.memberId} className={`flex items-center gap-2 ${poolFund ? "opacity-40" : ""}`}>
                          <label className="flex flex-1 items-center gap-2 cursor-pointer">
                            <input type="checkbox" checked={on} disabled={poolFund} onChange={() => toggleFunder(src.memberId, src.spare)} className="accent-amber-600" />
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
                  {/* Pool = covers the whole thing; peer advances cover the gap (auto-repaid when income lands). */}
                  {poolFund ? (
                    <p className="mt-2 font-medium">🏦 Pool pays the full {formatINR(amount ? Number(amount) : shortfallAmt)}{poolBill ? " · 2 steps" : ""} ✓</p>
                  ) : (
                    <p className="mt-2 font-medium">
                      Covered {formatINR(coveredTotal)} of {formatINR(shortfallAmt)}
                      {fullyCovered ? " ✓" : ` — ${formatINR(Math.max(0, Math.round((shortfallAmt - coveredTotal) * 100) / 100))} still needed`}
                    </p>
                  )}
                  {funding && !poolFund && (
                    <input type="hidden" name="funders" value={JSON.stringify(Object.entries(picks).filter(([, a]) => a > 0).map(([m, a]) => ({ memberId: Number(m), amount: a })))} />
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
