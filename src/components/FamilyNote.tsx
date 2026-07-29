"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { saveFamilyNote, type NoteState } from "@/app/actions";

// The shared family note editor. One common note, editable by any member (behind the app
// lock). Explicit Save (clearer for everyone than autosave, and avoids surprise overwrites);
// shows who last edited it and when. Last-write-wins — fine for a household scratch pad.
export function FamilyNote({
  initial,
  lastEditedBy,
  lastEditedAtISO,
}: {
  initial: string;
  lastEditedBy: string | null;
  lastEditedAtISO: string | null;
}) {
  const [value, setValue] = useState(initial);
  const [state, formAction, pending] = useActionState<NoteState, FormData>(saveFamilyNote, { ok: false, n: 0 });
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const prevN = useRef(0);

  // On a successful save, mark the current text as the new baseline.
  const [baseline, setBaseline] = useState(initial);
  useEffect(() => {
    if (state.n > prevN.current) {
      prevN.current = state.n;
      setBaseline(value);
      setSavedAt(new Date().toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.n]);

  const dirty = value !== baseline;
  const edited = lastEditedBy && lastEditedAtISO
    ? `Last edited by ${lastEditedBy} · ${new Date(lastEditedAtISO).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}`
    : "Not written yet — start typing.";

  return (
    <form action={formAction} className="space-y-3">
      <textarea
        name="notes"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={16}
        placeholder="Anything the family should see — important dates, contacts, house details, to-remember stuff…"
        className="w-full resize-y rounded-xl border border-slate-200 bg-white p-4 text-[15px] leading-relaxed text-slate-800 shadow-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-slate-400">{edited}</span>
        <div className="flex items-center gap-3">
          {dirty ? (
            <span className="text-xs font-medium text-amber-600">Unsaved changes</span>
          ) : savedAt ? (
            <span className="text-xs font-medium text-emerald-600">Saved {savedAt}</span>
          ) : null}
          <button
            type="submit"
            disabled={pending || !dirty}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
      <p className="text-[11px] text-slate-400">
        Shared with everyone in the family (behind the passcode). Please don&apos;t store passwords or
        OTPs here — use a password manager for those.
      </p>
    </form>
  );
}
