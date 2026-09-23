"use client";

import { useFormStatus } from "react-dom";
import { createNextMonthDraft } from "@/app/actions";

// Building next month clones the whole sheet server-side, then redirects to it — a beat or two. While
// that runs, useFormStatus.pending stays true (it spans the action AND the navigation), so we dim the
// page and show a shimmering sheet skeleton so it's clearly loading, not stuck.
function ShimmerOverlay() {
  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-white/70 p-4 pt-20 backdrop-blur-sm sm:pt-28">
      <div className="w-full max-w-3xl space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-violet-700">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-violet-200 border-t-violet-600" />
          🔮 Building next month…
        </div>
        <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="shimmer-block h-9 w-9 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="shimmer-block h-3.5 w-1/2 rounded" />
                <div className="shimmer-block h-3 w-1/3 rounded" />
              </div>
              <div className="shimmer-block h-4 w-16 shrink-0 rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <>
      <button
        disabled={pending}
        aria-busy={pending}
        className="inline-flex items-center gap-1.5 rounded-full border border-violet-300 bg-violet-50 px-3 py-1 text-xs font-medium text-violet-700 hover:bg-violet-100 disabled:cursor-wait disabled:opacity-70"
      >
        {pending ? (
          <>
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-violet-300 border-t-violet-600" />
            Building…
          </>
        ) : (
          "🔮 Preview next month →"
        )}
      </button>
      {pending && <ShimmerOverlay />}
    </>
  );
}

export function PreviewNextMonthButton({ householdId }: { householdId: number }) {
  return (
    <form action={createNextMonthDraft}>
      <input type="hidden" name="householdId" value={householdId} />
      <SubmitButton />
    </form>
  );
}
