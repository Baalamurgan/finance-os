import Link from "next/link";
import { formatINR } from "@/lib/format";
import type { CardReminder } from "@/lib/personal/cash";

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

const TONES = {
  red: "border-red-200 bg-red-50 text-red-800",
  amber: "border-amber-200 bg-amber-50 text-amber-800",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
} as const;

// Due-bill reminder shown on the Personal landing when a card's bill is due soon / overdue.
// Shows BOTH the in-app tagged total and the card-ledger outstanding, side by side, so a
// mismatch is easy to spot. Links to the card. Mark-paid lives on the Expenses "on card" strip.
export function CardBillReminderBanner({ reminders }: { reminders: CardReminder[] }) {
  if (reminders.length === 0) return null;
  return (
    <div className="space-y-2">
      {reminders.map((r) => {
        const tone = r.overdue ? "red" : r.daysUntilDue <= 2 ? "amber" : "emerald";
        const when = r.overdue
          ? `overdue by ${-r.daysUntilDue} day${r.daysUntilDue === -1 ? "" : "s"}`
          : r.daysUntilDue === 0
            ? "due today"
            : `due in ${r.daysUntilDue} day${r.daysUntilDue === 1 ? "" : "s"}`;
        return (
          <Link key={r.cardId} href={`/personal/finance/${r.cardId}`} className={`block rounded-xl border p-3 ${TONES[tone]}`}>
            <div className="flex items-center gap-2">
              <span className="text-base leading-none">⏰</span>
              <span className="text-sm font-semibold">
                {r.cardName} bill {when}
              </span>
              <span className="ml-auto text-xs opacity-70">{fmtDate(r.dueISO)} ›</span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-xs">
              <span className="opacity-80">On card (tagged) <b className="tabular-nums">{formatINR(r.taggedTotal)}</b></span>
              <span className="opacity-80">Card outstanding <b className="tabular-nums">{formatINR(r.ledgerOutstanding)}</b></span>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
