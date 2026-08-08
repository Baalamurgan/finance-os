"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { syncMonthFromSetup } from "@/app/actions";
import { useToast } from "@/components/Toast";

// Pulls this month's Sheet lines from the Setup template (amounts, due-days, budgets & bills) and
// recomputes the carry estimate. Lines you edited on the Sheet for this month are "📌 kept" (pinned)
// and left untouched. Distinct from the Money-plan refresh, which only re-derives the steps.
export function SheetRefreshButton({ periodId }: { periodId: number }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();

  const refresh = () =>
    start(async () => {
      const r = await syncMonthFromSetup(periodId);
      if (r.ok) router.refresh();
      toast(
        r.ok ? (r.updated > 0 ? `Synced — ${r.updated} line${r.updated > 1 ? "s" : ""} updated from Setup` : "Synced — Setup already matched (pinned lines kept)") : (r.error ?? "Couldn't sync"),
        r.ok ? "success" : "error",
      );
    });

  return (
    <button
      type="button"
      onClick={refresh}
      disabled={pending}
      title="Pull amounts / due-days / budgets from Setup. Lines you edited this month (📌 kept) are left alone."
      className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
    >
      <span className={pending ? "inline-block animate-spin" : ""}>↻</span> {pending ? "Syncing…" : "Sync from Setup"}
    </button>
  );
}
