"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { restoreLine } from "@/app/actions";

// Shown on a Setup line the head DELETED for this month — a persistent "removed" override that a
// rebuild/sync won't bring back (see REMOVED_NOTE). When editing is allowed, a "↩" button restores it
// in place, re-pulling the current Setup value.
export function RemovedBadge({ kind, id, canEdit }: { kind: "income" | "expense"; id: number; canEdit: boolean }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  const restore = () =>
    startTransition(async () => {
      const fd = new FormData();
      fd.set("kind", kind);
      fd.set("id", String(id));
      await restoreLine(fd);
      router.refresh();
      toast("Restored from Setup", "success");
    });

  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500" title="Removed for this month — a rebuild or refresh from Setup won't bring it back">
      🗑 removed
      {canEdit && (
        <button
          type="button"
          onClick={restore}
          disabled={pending}
          title="Restore this line from Setup"
          className="rounded-full px-0.5 leading-none text-slate-500 hover:text-emerald-600 disabled:opacity-50"
        >
          ↩
        </button>
      )}
    </span>
  );
}
