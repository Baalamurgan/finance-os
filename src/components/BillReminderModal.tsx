"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { setBillReminderConfig } from "@/app/actions";

// Per-bill reminder settings, opened from the row's 🔔 so the (already long) Setup table row
// isn't overloaded. Holds the notify on/off toggle + how many days before the due date to
// start reminding. The month On/Off (pause) toggle stays inline on the row — separate concern.
export function BillReminderModal({
  categoryId,
  name,
  remind,
  reminderDays,
}: {
  categoryId: number;
  name: string;
  remind: boolean;
  reminderDays: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [on, setOn] = useState(remind);
  const [days, setDays] = useState(reminderDays != null ? String(reminderDays) : "");

  useEffect(() => setMounted(true), []);
  useEffect(() => { if (open) { setOn(remind); setDays(reminderDays != null ? String(reminderDays) : ""); } }, [open, remind, reminderDays]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={remind ? "Reminder on — tap for settings" : "Reminder muted — tap for settings"}
        className={`rounded-md px-1.5 py-1 text-sm transition-colors ${remind ? "text-amber-500 hover:bg-amber-50" : "text-slate-300 hover:bg-slate-100"}`}
      >
        {remind ? "🔔" : "🔕"}
      </button>

      {open && mounted && createPortal(
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-sm rounded-t-2xl bg-white shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()} style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <h2 className="text-base font-bold text-slate-900">Reminder · {name}</h2>
              <button type="button" onClick={() => setOpen(false)} className="rounded-md px-2 text-slate-400 hover:bg-slate-100" aria-label="Close">✕</button>
            </div>

            <form
              action={setBillReminderConfig}
              onSubmit={() => setOpen(false)}
              className="space-y-4 px-5 py-4"
            >
              <input type="hidden" name="categoryId" value={categoryId} />
              <input type="hidden" name="remind" value={on ? "on" : ""} />

              <label className="flex cursor-pointer items-center justify-between gap-3">
                <span className="text-sm font-medium text-slate-700">Notify me for this bill</span>
                <button
                  type="button"
                  onClick={() => setOn((v) => !v)}
                  aria-pressed={on}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${on ? "bg-indigo-600" : "bg-slate-300"}`}
                >
                  <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : "translate-x-0.5"}`} />
                </button>
              </label>

              <div>
                <label className="text-sm font-medium text-slate-700">Remind me before (days)</label>
                <p className="text-xs text-slate-400">How many days before the due date to start. Blank = default (3).</p>
                <input
                  name="reminderDays"
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                  inputMode="numeric"
                  placeholder="3"
                  disabled={!on}
                  className="input mt-1.5 w-24 disabled:bg-slate-100 disabled:text-slate-400"
                />
              </div>

              <p className="text-[11px] text-slate-400">
                Reminders go to the responsible member, the head, and managers — daily from this window until the bill is marked paid.
              </p>

              <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
                <button type="button" onClick={() => setOpen(false)} className="rounded-md px-3 py-2 text-sm text-slate-500 hover:bg-slate-100">Cancel</button>
                <button type="submit" className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">Save</button>
              </div>
            </form>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
