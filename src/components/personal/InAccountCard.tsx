"use client";

import { useState } from "react";
import { formatINR } from "@/lib/format";

// "In account now" — your personal account's real balance (or, with no personal account, the calculated
// figure), expandable into what it's made of, like the family In-Hand card: what you can still spend, money
// held for card bills, lent out, owed to others, a card-bill share still to move between accounts — and, only
// when the parts don't add up to the real balance, one quiet "Other" line so they always do.
function Row({ label, value, sign, muted }: { label: React.ReactNode; value: number; sign: "+" | "−" | ""; muted?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-2 text-[12px] ${muted ? "text-slate-400" : "text-slate-600"}`}>
      <span className="min-w-0">{label}</span>
      <span className="shrink-0 tabular-nums">{sign}{formatINR(Math.abs(value))}</span>
    </div>
  );
}

export function InAccountCard({
  accountName, balance, canSpend, cards, lent, toRepay, toSend, toCome, otherName,
}: {
  accountName: string | null; // the personal account (Jupiter); null → no account, headline is the calculation
  balance: number | null;     // its real balance
  canSpend: number;
  cards: { name: string; color: string; amount: number }[]; // your share of each unpaid card bill
  lent: number;     // out on loan — to receive
  toRepay: number;  // you owe others (incl. a spend on someone else's card)
  toSend: number;   // a card-bill share still to send from this account
  toCome: number;   // a card-bill share still to come into it
  otherName: string | null;
}) {
  const [open, setOpen] = useState(false);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const cardTotal = r2(cards.reduce((t, c) => t + c.amount, 0));
  const parts = r2(canSpend + cardTotal - lent + toRepay + toSend - toCome);
  const headline = balance ?? parts;
  const other = balance != null ? r2(balance - parts) : 0;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="block w-full text-left">
        <div className="flex items-center justify-between text-[11px] font-medium uppercase tracking-wide text-slate-400">
          <span>In account now{accountName ? ` · ${accountName}` : ""}</span>
          <span className={`text-[10px] transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
        </div>
        <div className={`mt-1 text-xl font-bold ${headline >= 0 ? "text-slate-800" : "text-red-600"}`}>{formatINR(headline)}</div>
        {!open && (
          <div className="text-[10px] text-slate-400">
            {[cardTotal > 0.005 ? `${formatINR(cardTotal)} held for cards` : null, lent > 0.005 ? `${formatINR(lent)} out on loan` : null, toRepay > 0.005 ? `${formatINR(toRepay)} to repay` : null].filter(Boolean).join(" · ") || "tap to see what it's made of"}
          </div>
        )}
      </button>
      {open && (
        <div className="mt-2 space-y-1 border-t border-slate-100 pt-2">
          <Row label="💰 Can spend (left this month)" value={canSpend} sign={canSpend < 0 ? "−" : ""} />
          {cards.length > 0 && (
            <>
              <Row label="💳 Held for card bills (your share)" value={cardTotal} sign="+" />
              {cards.map((c) => (
                <div key={c.name} className="flex items-baseline justify-between gap-2 pl-4 text-[11px] text-slate-400">
                  <span className="flex min-w-0 items-center gap-1"><span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: c.color }} />{c.name}</span>
                  <span className="tabular-nums">{formatINR(c.amount)}</span>
                </div>
              ))}
            </>
          )}
          {lent > 0.005 && <Row label="🤝 Out on loan (to receive)" value={lent} sign="−" />}
          {toRepay > 0.005 && <Row label="↩️ To repay others" value={toRepay} sign="+" />}
          {toSend > 0.005 && <Row label={`↔ Card-bill share to send to ${otherName ?? "your other account"}`} value={toSend} sign="+" />}
          {toCome > 0.005 && <Row label={`↔ Card-bill share to come from ${otherName ?? "your other account"}`} value={toCome} sign="−" />}
          {Math.abs(other) >= 1 && <Row label="Other" value={other} sign={other < 0 ? "−" : "+"} muted />}
          <div className="flex items-baseline justify-between gap-2 border-t border-slate-100 pt-1 text-[12px] font-semibold text-slate-800">
            <span>{accountName ? `= In ${accountName}` : "= In account"}</span>
            <span className="tabular-nums">{formatINR(headline)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
