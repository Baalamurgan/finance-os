"use client";

import { useState } from "react";
import { formatINR } from "@/lib/format";
import { PayCardBillModal } from "@/components/PayCardBillModal";
import type { CardUnbilled, PendingCardBill } from "@/lib/queries";

// One credit card's cash an owner holds in their In-Hand: the statement due now (with Pay) + spends that
// will land on a LATER statement. Short title on the card; the full story (every spend with its date, the
// budget month it came from, and links to the Spends tab filtered to this card) lives in a popup.
const d = (iso: string, o: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) => new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", ...o });
const ym = (iso: string) => { const t = new Date(new Date(iso).getTime() + 330 * 60000); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1 }; };

export function InHandCardBlock({
  cardId,
  name,
  color,
  due,
  next,
  canPay,
  categories,
}: {
  cardId: number;
  name: string;
  color: string;
  due: PendingCardBill[];
  next: CardUnbilled[];
  canPay: boolean;
  categories: { id: number; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const total = Math.round((due.reduce((s, b) => s + b.familyAmount, 0) + next.reduce((s, u) => s + u.amount, 0)) * 100) / 100;
  const short = name.replace(/\s*[-–]\s*.*$/, ""); // "RBL XTRA - IndianOil" → "RBL XTRA"
  const allItems = [...due.flatMap((b) => b.items), ...next.flatMap((u) => u.items)];
  // Spends-tab links: one per budget month the spends came from, filtered to this card.
  const months = [...new Map(allItems.map((i) => { const k = ym(i.dateISO); return [`${k.y}-${k.m}`, k]; })).values()].sort((a, b) => a.y * 12 + a.m - (b.y * 12 + b.m));
  return (
    <>
      <li className="flex items-center justify-between gap-2">
        <button type="button" onClick={() => setOpen(true)} title="See every spend on this card" className="truncate text-left underline decoration-dotted underline-offset-2" style={{ color }}>
          💳 {short} <span className="text-slate-400">· card cash ⓘ</span>
        </button>
        <span className="shrink-0 tabular-nums font-medium" style={{ color }}>{formatINR(total)}</span>
      </li>
      {due.map((b) => (
        <li key={`d${b.cycleEndISO}`} className="flex items-center justify-between gap-2 pl-3 text-[10px]">
          <span className="truncate text-slate-500"><span className="mr-1 text-slate-300">↳</span>{d(b.cycleEndISO, { month: "short" })} bill · due {d(b.dueISO)}</span>
          <span className="flex shrink-0 items-center gap-1.5">
            <span className="tabular-nums text-slate-600">{formatINR(b.familyAmount)}</span>
            {canPay && (
              <PayCardBillModal cardId={b.cardId} cardName={b.cardName} color={b.color} cycleEndISO={b.cycleEndISO} dueISO={b.dueISO} familyBudgeted={b.familyBudgeted} familyBudgetedByMonth={b.familyBudgetedByMonth} familyMisc={b.familyMisc} personalAmount={b.personalAmount} annualFee={b.annualFee} categories={categories} />
            )}
          </span>
        </li>
      ))}
      {next.map((u) => (
        <li key={`n${u.cycleEndISO}`} className="flex items-center justify-between gap-2 pl-3 text-[10px]">
          <span className="truncate text-slate-500"><span className="mr-1 text-slate-300">↳</span>next bill{u.dueISO ? ` · due ${d(u.dueISO)}` : ""}</span>
          <span className="shrink-0 tabular-nums text-slate-600">{formatINR(u.amount)}</span>
        </li>
      ))}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={() => setOpen(false)}>
          <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-sm font-semibold" style={{ color }}>💳 {name}</div>
                <div className="text-[11px] text-slate-500">Family budget cash you hold until the bank is paid · {formatINR(total)}</div>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="rounded-md px-2 text-slate-400 hover:bg-slate-100" aria-label="Close">✕</button>
            </div>
            {due.map((b) => (
              <section key={`pd${b.cycleEndISO}`} className="mt-3">
                <div className="flex justify-between text-xs font-semibold text-slate-700">
                  <span>Statement {d(b.cycleEndISO)} · due {d(b.dueISO)}</span><span className="tabular-nums">{formatINR(b.familyAmount)}</span>
                </div>
                {b.familyBudgetedByMonth.length > 1 && (
                  <div className="text-[10px] text-slate-400">from {b.familyBudgetedByMonth.map((m) => `${d(m.monthISO, { month: "short" })} budget ${formatINR(m.amount)}`).join(" · ")}{b.familyMisc > 0.005 ? ` · misc ${formatINR(b.familyMisc)}` : ""}</div>
                )}
                <SpendList items={b.items} />
              </section>
            ))}
            {next.map((u) => (
              <section key={`pn${u.cycleEndISO}`} className="mt-3">
                <div className="flex justify-between text-xs font-semibold text-slate-700">
                  <span>Next statement {d(u.cycleEndISO)}{u.dueISO ? ` · due ${d(u.dueISO)}` : ""}</span><span className="tabular-nums">{formatINR(u.amount)}</span>
                </div>
                <div className="text-[10px] text-slate-400">spends from earlier budget months only — this month&apos;s card spends sit inside the budget lines</div>
                <SpendList items={u.items} />
              </section>
            ))}
            <div className="mt-4 flex flex-wrap gap-2">
              {months.map((k) => (
                <a key={`${k.y}-${k.m}`} href={`/expenses?y=${k.y}&m=${k.m}&card=${cardId}`} className="rounded-full border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50">
                  Open {new Date(Date.UTC(k.y, k.m - 1, 15)).toLocaleDateString("en-IN", { month: "short" })} spends on {short} ↗
                </a>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function SpendList({ items }: { items: { label: string; amount: number; dateISO: string; budgeted: boolean }[] }) {
  if (items.length === 0) return null;
  const sorted = [...items].sort((a, b) => a.dateISO.localeCompare(b.dateISO));
  return (
    <ul className="mt-1 divide-y divide-slate-100 text-[11px]">
      {sorted.map((i, n) => (
        <li key={n} className="flex items-center justify-between gap-2 py-1">
          <span className="truncate text-slate-600"><span className="mr-1.5 tabular-nums text-slate-400">{d(i.dateISO)}</span>{i.label}{!i.budgeted && <span className="ml-1 rounded bg-amber-50 px-1 text-[9px] text-amber-600">misc</span>}</span>
          <span className="shrink-0 tabular-nums text-slate-700">{formatINR(i.amount)}</span>
        </li>
      ))}
    </ul>
  );
}
