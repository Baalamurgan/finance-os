"use client";

import Link from "next/link";
import { formatINR } from "@/lib/format";
import { ToastForm } from "@/components/ToastForm";
import { markCardBillPaid } from "@/app/personal/actions";

export type CardBill = {
  cardId: number; cardName: string; payAmount: number; totalDue: number;
  dueISO: string | null; cycleEnd: string | null; needsSetup: boolean;
};
type Acct = { id: number; name: string };

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : null;

// An executable card-bill step: pay the oldest unpaid cycle from a chosen account (its balance drops) and
// clear the cycle. Falls back to a link when the card has no statement day (can't derive a cycle yet).
export function CardBillStep({ bill, accounts }: { bill: CardBill; accounts: Acct[] }) {
  const hasMore = bill.totalDue - bill.payAmount > 0.005;

  if (bill.needsSetup || !bill.cycleEnd) {
    return (
      <Link href={`/personal/finance/${bill.cardId}`} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 p-3 hover:bg-slate-50">
        <span className="flex min-w-0 items-center gap-2">
          <span>💳</span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-slate-800">{bill.cardName} bill</span>
            <span className="block text-[11px] text-amber-600">set a statement day →</span>
          </span>
        </span>
        <span className="shrink-0 tabular-nums font-semibold text-red-600">{formatINR(bill.totalDue)}</span>
      </Link>
    );
  }

  return (
    <ToastForm action={markCardBillPaid} successMessage="Bill paid" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 p-3">
      <input type="hidden" name="cardAccountId" value={bill.cardId} />
      <input type="hidden" name="cycleEnd" value={bill.cycleEnd} />
      <input type="hidden" name="amount" value={bill.payAmount} />
      <input type="hidden" name="cycleTotal" value={bill.payAmount} />
      <span className="flex min-w-0 items-center gap-2">
        <span>💳</span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-slate-800">{bill.cardName} bill</span>
          <span className="block text-[11px] text-slate-400">
            {fmtDate(bill.dueISO) ? `due ${fmtDate(bill.dueISO)}` : "due date not set"}
            {hasMore ? ` · +${formatINR(bill.totalDue - bill.payAmount)} in older cycles` : ""}
          </span>
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <span className="tabular-nums font-semibold text-red-600">{formatINR(bill.payAmount)}</span>
        {accounts.length > 0 && (
          <select name="fromAccountId" defaultValue="" title="Pay from" className="rounded border border-slate-200 px-1.5 py-1 text-xs text-slate-600 outline-none focus:border-emerald-400">
            <option value="">from cash</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        )}
        <button type="submit" className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700">Mark paid</button>
      </span>
    </ToastForm>
  );
}
