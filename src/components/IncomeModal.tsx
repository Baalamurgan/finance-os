"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useSavingToast } from "@/components/useSavingToast";
import { addIncomeAction, updateIncome, type SaveState } from "@/app/actions";
import { useToast } from "@/components/Toast";

type Mem = { id: number; name: string };
type IncomeInitial = { id: number; source: string; amount: number; ownerId: number | null; dueDay?: number | null; oneOff?: boolean; received?: boolean };

// Add- or Edit-income modal. Add mode matches the Sheet "+ Add expense" UI;
// edit mode (initial set) is opened from the row kebab and posts to updateIncome.
export function IncomeModal({
  members,
  periodId,
  initial,
  hideTrigger = false,
  controlledOpen,
  onOpenChange,
}: {
  members: Mem[];
  periodId: number;
  initial?: IncomeInitial;
  hideTrigger?: boolean;
  controlledOpen?: boolean;
  onOpenChange?: (v: boolean) => void;
}) {
  const isEdit = !!initial;
  // Received in the Money Plan → the money has moved: amount, owner and arrival day are locked (undo the
  // step there to change them). The name and "Repeat every month" stay editable.
  const locked = isEdit && !!initial!.received;
  const toast = useToast();
  const [uncontrolled, setUncontrolled] = useState(false);
  const open = controlledOpen ?? uncontrolled;
  const setOpen = (v: boolean) => {
    onOpenChange?.(v);
    if (controlledOpen === undefined) setUncontrolled(v);
  };

  const formRef = useRef<HTMLFormElement>(null);
  const prevN = useRef(0);
  const [state, formAction, pending] = useActionState<SaveState, FormData>(
    isEdit ? updateIncome : addIncomeAction,
    { ok: false, n: 0 },
  );
  useSavingToast(pending); // hide + "Saving…" while the server works; the result toast replaces it

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // close (+ reset in add mode) only on a real successful save
  useEffect(() => {
    if (state.n > prevN.current) {
      prevN.current = state.n;
      toast(isEdit ? "Income updated" : "Income added", "success");
      if (!isEdit) formRef.current?.reset();
      setOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.n]);

  return (
    <>
      {!hideTrigger && (
        <button
          onClick={() => setOpen(true)}
          className="w-full rounded-lg border border-dashed border-green-300 px-3 py-2 text-left text-sm font-medium text-green-700 hover:bg-green-50"
        >
          + Add income
          <span className="block text-[11px] font-normal text-slate-400">
            salary / rent / one-off — adds to the balance
          </span>
        </button>
      )}

      {open && (
        <div
          className={`fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center${pending ? " hidden" : ""}`}
          onClick={() => setOpen(false)}
        >
          <div
            className="modal-panel my-auto flex max-h-[88vh] w-full max-w-md flex-col rounded-2xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <h2 className="text-lg font-bold text-slate-900">{isEdit ? "Edit income" : "Add income"}</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md px-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <form ref={formRef} action={formAction} className="flex min-h-0 flex-col">
              <div className="space-y-4 overflow-y-auto px-5 py-4">
                <input type="hidden" name="periodId" value={periodId} />
                {isEdit && <input type="hidden" name="id" value={initial!.id} />}

                <div>
                  <label className="text-xs font-medium text-slate-500">Amount (₹)</label>
                  <input
                    name="amount"
                    type="number"
                    step="0.01"
                    inputMode="decimal"
                    autoFocus={!locked}
                    required
                    readOnly={locked}
                    defaultValue={isEdit ? initial!.amount : ""}
                    placeholder="0"
                    className={`mt-1 w-full rounded-lg border border-slate-300 px-3 py-3 text-3xl font-bold tabular-nums outline-none focus:border-green-400 focus:ring-2 focus:ring-green-100 ${locked ? "cursor-not-allowed bg-slate-50 text-slate-500" : ""}`}
                  />
                  {locked && <p className="mt-1 text-[11px] text-slate-500">🔒 Received in the Money Plan — amount, owner and day are locked. Undo it there to change them.</p>}
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-500">Source</label>
                  <input
                    name="source"
                    required
                    defaultValue={isEdit ? initial!.source : ""}
                    placeholder="e.g. Bala salary, G704 rent"
                    className="input mt-1 w-full"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-500">Owner</label>
                  {locked && <input type="hidden" name="ownerId" value={initial!.ownerId?.toString() ?? ""} />}
                  <select
                    name={locked ? undefined : "ownerId"}
                    disabled={locked}
                    className="input mt-1 w-full disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500"
                    defaultValue={isEdit ? (initial!.ownerId?.toString() ?? "") : ""}
                  >
                    <option value="">Shared</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </div>

                {/* optional arrival day — drives Money-plan ordering (when this income lands) */}
                <div>
                  <label className="text-xs font-medium text-slate-500">Arrives on day (optional)</label>
                  <input
                    name="dueDay"
                    type="number"
                    min="1"
                    max="31"
                    inputMode="numeric"
                    readOnly={locked}
                    defaultValue={isEdit ? (initial!.dueDay ?? "") : ""}
                    placeholder="e.g. 1"
                    className="input mt-1 w-full"
                  />
                  <p className="mt-1 text-[11px] text-slate-400">
                    Day of the month it arrives — leave blank for &ldquo;up front&rdquo; (sorts first in the Money plan).
                  </p>
                </div>

                {/* Add: repeat by default. Edit: shows the line's current state; switching it off makes this month's
                    line a one-off and stops its Setup template (next month won't get it again). */}
                <label className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  {isEdit && <input type="hidden" name="repeatSet" value="1" />}
                  <input type="checkbox" name="repeat" defaultChecked={isEdit ? !initial!.oneOff : true} className="h-4 w-4 accent-green-600" />
                  Repeat every month
                  <span className="text-xs text-slate-400">{isEdit ? "(off = only this month; next month won't get it)" : "(uncheck = only this month)"}</span>
                </label>
              </div>

              <div className="modal-foot flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md px-3 py-2 text-sm text-slate-500 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button type="submit" disabled={pending} className="btn disabled:opacity-40">
                  {pending ? "Saving…" : isEdit ? "Save changes" : "Add income"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
