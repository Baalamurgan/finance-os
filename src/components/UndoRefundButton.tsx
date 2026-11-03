"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { undoRefund } from "@/app/actions";
import { CTA_CLASS, CtaLabel } from "@/components/Cta";

// Undo a refund (head only): removes its refund line, card/account line, income and Money Plan move.
// The server refuses once the refund's Money Plan move is ticked (the money was already sent).
export function UndoRefundButton({ refundId }: { refundId: number }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const fd = new FormData();
          fd.set("id", String(refundId));
          const r = await undoRefund(fd);
          if (!r.ok) { toast(r.error ?? "Couldn't undo the refund", "error"); return; }
          toast("Refund undone", "success");
          router.refresh();
        })
      }
      className={`${CTA_CLASS.undo} disabled:opacity-50`}
    >
      <CtaLabel kind="undo">{pending ? "Undoing…" : "Undo refund"}</CtaLabel>
    </button>
  );
}
