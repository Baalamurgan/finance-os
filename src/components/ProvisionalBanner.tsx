"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { syncMonthFromSetup } from "@/app/actions";
import { useToast } from "@/components/Toast";

/**
 * Shown when the month you're viewing is OPEN but an earlier month hasn't wound down yet. It's a
 * real, editable month — but its carry-forward from the working month is only an ESTIMATE until
 * that month closes, so we badge it as a preview and (for head/manager) offer a one-tap refresh.
 * The refresh re-pulls the whole month from Setup (amounts, due days, budgets & bills) AND
 * recomputes the carry estimate — the same Setup sync as the Sheet's "Sync from Setup" button
 * (pinned month-edits are kept). The Money-plan refresh is separate: it only re-derives the steps.
 */
export function ProvisionalBanner({ workingLabel, periodId, canEdit }: { workingLabel: string; periodId: number; canEdit: boolean }) {
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();

  const refresh = () => {
    start(async () => {
      const res = await syncMonthFromSetup(periodId);
      toast(res.ok ? `Refreshed from Setup (carry est. from ${workingLabel})` : (res.error ?? "Couldn't refresh"), res.ok ? "success" : "error");
      if (res.ok) router.refresh();
    });
  };

  return (
    <div className="border-b border-violet-200 bg-violet-50 text-violet-900">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2 text-sm sm:px-6">
        <span className="text-base leading-none">⏳</span>
        <span className="min-w-0 flex-1">
          <b>Preview</b> — {workingLabel}{" "}hasn&apos;t been wound down yet, so the carry-forward here is an estimate.
        </span>
        {canEdit && (
          <button
            type="button"
            onClick={refresh}
            disabled={pending}
            title="Recompute the last-month surplus & carried amounts from the working month"
            className="shrink-0 whitespace-nowrap rounded-md bg-violet-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50"
          >
            <span className={pending ? "inline-block animate-spin" : ""}>↻</span> {pending ? "Refreshing…" : "Refresh estimate"}
          </button>
        )}
      </div>
    </div>
  );
}
