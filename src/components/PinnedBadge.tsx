"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { unpinLine } from "@/app/actions";

// Shown on a Sheet line whose amount/due-day was edited for THIS month: a "📌 kept" badge so it's
// clear the value is intentionally held and a refresh-from-Setup won't touch it. When editing is
// allowed, a "↻" button un-pins the line and re-pulls the Setup value (so it follows Setup again).
export function PinnedBadge({ kind, id, canEdit }: { kind: "income" | "expense"; id: number; canEdit: boolean }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  const unpin = () =>
    startTransition(async () => {
      const fd = new FormData();
      fd.set("kind", kind);
      fd.set("id", String(id));
      const r = await unpinLine(fd);
      router.refresh();
      toast(r.ok ? "Re-synced from Setup" : (r.error ?? "Couldn't re-sync"), r.ok ? "success" : "error");
    });

  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-600" title="Edited for this month — a refresh from Setup won't change it">
      📌 kept
      {canEdit && (
        <button
          type="button"
          onClick={unpin}
          disabled={pending}
          title="Un-pin & re-sync this line from Setup"
          className="rounded-full px-0.5 leading-none text-amber-500 hover:text-amber-700 disabled:opacity-50"
        >
          ↻
        </button>
      )}
    </span>
  );
}
