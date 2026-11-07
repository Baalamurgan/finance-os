"use client";

import { useTransition } from "react";
import { useToast } from "@/components/Toast";
import { formatINR } from "@/lib/format";

export type MonthNote = { label: string; missing: boolean; amount: number | null; done: boolean; differs: boolean };

// Under a Setup item: how this month's own copy compares, and an opt-in "Apply to this month". Setup edits never
// reach the month by themselves — this button is the only bridge. Shown only when the month differs.
export function ApplyToMonth({ note, id, periodId, action }: {
  note: MonthNote | null; id: number; periodId: number | null;
  action: (fd: FormData) => Promise<{ ok: boolean; error?: string }>;
}) {
  const toast = useToast();
  const [pending, start] = useTransition();
  if (!note || !note.differs || periodId == null) return null;
  const what = note.missing ? `Not in ${note.label}` : `${note.label}: ${formatINR(note.amount ?? 0)}${note.done ? " · done" : ""}`;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 pl-7 text-[11px]">
      <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700" title="This month keeps its own copy — Setup changes apply from next month">{what}</span>
      {!note.done && (
        <button
          type="button"
          disabled={pending}
          onClick={() => start(async () => {
            const fd = new FormData();
            fd.set("id", String(id));
            fd.set("periodId", String(periodId));
            const r = await action(fd);
            toast(r.ok ? `Applied to ${note.label}` : r.error ?? "Couldn't apply", r.ok ? "success" : "error");
          })}
          className="rounded-md border border-emerald-200 px-2 py-0.5 font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-40"
        >
          {pending ? "Applying…" : note.missing ? `Add to ${note.label}` : `Apply to ${note.label}`}
        </button>
      )}
    </div>
  );
}
