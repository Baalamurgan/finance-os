"use client";

import { useEffect, useState } from "react";
import { getMyIncomingPeerCardUses, type PeerCardUse } from "@/app/personal/actions";
import { formatINR } from "@/lib/format";

// A one-time popup for the receiving end of a household-linked spend you didn't make: your card was used
// by another member (peer-card spend), OR someone split a spend / reimbursement with you and you now owe.
// Shows each exactly once — the shown ids are remembered per-device in localStorage, so it won't nag
// again. Fetches its own data on mount (like CardDueHighAlert), so no page threads props. New items
// surface the next time you open Personal until acknowledged.
const SEEN_KEY = "peercarduse:seen";

function readSeen(): number[] {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]"); } catch { return []; }
}

export function PeerCardUsePopup() {
  const [uses, setUses] = useState<PeerCardUse[] | null>(null);

  useEffect(() => {
    let alive = true;
    getMyIncomingPeerCardUses()
      .then((all) => {
        if (!alive) return;
        const seen = new Set(readSeen());
        const unseen = all.filter((u) => !seen.has(u.id));
        if (unseen.length > 0) setUses(unseen);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  if (!uses || uses.length === 0) return null;

  const close = () => {
    try {
      const next = Array.from(new Set([...readSeen(), ...uses.map((u) => u.id)]));
      localStorage.setItem(SEEN_KEY, JSON.stringify(next));
    } catch {}
    setUses(null);
  };

  const one = uses.length === 1;
  const allCard = uses.every((u) => u.kind === "card");
  const allSplit = uses.every((u) => u.kind === "split");
  const allLoan = uses.every((u) => u.kind === "loan");
  const icon = allCard ? "💳" : allSplit ? "🤝" : allLoan ? "🧾" : "🔔";
  const title = allCard
    ? one ? "Your card was used" : "Your cards were used"
    : allSplit
      ? one ? "You've got a shared spend" : "You've got shared spends"
      : allLoan
        ? one ? "A new lending entry" : "New lending entries"
        : "New from your family";
  const subtitle = allCard
    ? "Someone in the family paid with your card — you'll be repaid. Track it in Lending."
    : allSplit
      ? "A family member shared a spend with you — you owe your share. Track it in Lending."
      : allLoan
        ? "A family member logged a lend/borrow with you. Track it in Lending."
        : "Family members logged money activity with you. Track it in Lending.";

  // Per-item phrasing. "you owe" (amber) when the member is on the borrowing side; "you'll be repaid"
  // when they're owed.
  const line = (u: (typeof uses)[number]) => {
    if (u.kind === "card") return <><b className="text-slate-900">{u.spender}</b> used {u.cardName ? <b>{u.cardName}</b> : "your card"}</>;
    if (u.kind === "split") return <><b className="text-slate-900">{u.spender}</b> split a spend with you — <span className="text-amber-700">you owe</span></>;
    // manual loan
    return u.direction === "borrowed"
      ? <><b className="text-slate-900">{u.spender}</b> lent you — <span className="text-amber-700">you owe</span></>
      : <><b className="text-slate-900">{u.spender}</b> borrowed from you — you&apos;ll be repaid</>;
  };

  return (
    <div className="fixed inset-0 z-[95] flex items-end justify-center overflow-y-auto bg-black/40 sm:items-center sm:p-4" onClick={close}>
      <div
        className="w-full max-w-sm rounded-t-3xl bg-white shadow-xl ring-2 ring-indigo-300 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="px-6 pt-6 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-indigo-100 text-3xl">{icon}</div>
          <h2 className="mt-3 text-lg font-bold text-indigo-700">{title}</h2>
          <p className="mt-1 text-xs text-slate-400">{subtitle}</p>
          <ul className="mt-3 space-y-2 text-left">
            {uses.map((u) => (
              <li key={u.id} className="rounded-xl bg-slate-50 px-3 py-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 text-sm text-slate-700">{line(u)}</span>
                  <span className="shrink-0 text-sm font-bold tabular-nums text-slate-900">{formatINR(u.amount)}</span>
                </div>
                {u.note && <div className="mt-0.5 truncate text-xs text-slate-500">for {u.note}</div>}
              </li>
            ))}
          </ul>
        </div>
        <div className="px-6 py-6">
          <button type="button" onClick={close} className="w-full rounded-xl bg-indigo-600 px-4 py-3 text-center text-base font-semibold text-white hover:bg-indigo-700">
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
