"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { rebuildDraftToast } from "@/app/actions";
import { useToast } from "@/components/Toast";

// Rebuild the next-month preview from the latest setup, and toast the result.
export function RebuildDraftButton({ periodId }: { periodId: number }) {
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();

  const onClick = () => {
    const fd = new FormData();
    fd.set("periodId", String(periodId));
    start(async () => {
      const res = await rebuildDraftToast(fd);
      toast(res.message, res.ok ? "success" : "error");
      if (res.ok) router.refresh();
    });
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="inline-flex items-center gap-1.5 rounded-md border border-violet-300 px-3 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-100 disabled:opacity-50"
    >
      <span className={pending ? "inline-block animate-spin" : ""}>↻</span> Rebuild
    </button>
  );
}
