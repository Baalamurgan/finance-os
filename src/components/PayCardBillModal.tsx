"use client";

import { useEffect, useState } from "react";
import { formatINR } from "@/lib/format";
import { payFamilyCardBill } from "@/app/actions";
import { useToastAction } from "@/components/Toast";
import { CTA_CLASS, CtaLabel } from "@/components/Cta";

// One line of the statement breakdown. Hoisted out of the modal so it isn't re-created each render.
function Row({ label, hint, value, strong }: { label: string; hint?: string; value: number; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-sm">
      <span className={strong ? "font-semibold text-slate-800" : "text-slate-600"}>
        {label} {hint && <span className="text-[11px] text-slate-400">{hint}</span>}
      </span>
      <span className={`shrink-0 tabular-nums ${strong ? "font-semibold text-slate-800" : "text-slate-600"}`}>{formatINR(value)}</span>
    </div>
  );
}

// One owner-only payment settles a whole family credit-card cycle. The amount defaults to the summed
// swipes (family + personal) + any annual fee, and is editable to the real statement figure — the ±
// difference vs the swipes is the card's fee/cashback. The split shows WHERE each rupee comes from:
// family spends from the held budget / in-hand, the owner's own spends from their Can-spend.
export function PayCardBillModal({
  cardId,
  cardName,
  color,
  cycleEndISO,
  dueISO,
  familyBudgeted,
  familyBudgetedByMonth = [],
  familyMisc,
  personalAmount,
  annualFee,
  categories = [],
}: {
  cardId: number;
  cardName: string;
  color: string;
  cycleEndISO: string;
  dueISO: string;
  familyBudgeted: number; // family spends in a budgeted category → funded from the held budget
  familyBudgetedByMonth?: { monthISO: string; amount: number }[]; // that budgeted portion split by budget month
  familyMisc: number; // family misc/other spends → funded from the owner's in-hand
  personalAmount: number;
  annualFee: number;
  // Family spend categories for booking the difference (extra charges / cashback). Empty → the difference
  // stays on the card's own ledger only (the old behaviour).
  categories?: { id: number; name: string }[];
}) {
  const withToast = useToastAction();
  const [open, setOpen] = useState(false);
  const swipeSubtotal = Math.round((familyBudgeted + familyMisc + personalAmount) * 100) / 100;
  const suggested = Math.round((swipeSubtotal + annualFee) * 100) / 100;
  const [amount, setAmount] = useState(String(Math.round(suggested)));
  const amountNum = Number(amount) || 0;
  const difference = Math.round((amountNum - suggested) * 100) / 100; // + = extra fees/charges, − = cashback/savings
  // An RBL-style fuel card's extra is almost always fuel surcharge → pre-pick a Fuel/Petrol category if there is one.
  const defaultCat = categories.find((c) => /fuel|petrol|diesel/i.test(c.name))?.id ?? "";
  const [cashbackTo, setCashbackTo] = useState<"personal" | "piggy" | "category">("personal");
  const booksDiff = categories.length > 0;
  const due = new Date(dueISO).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  // Show the budgeted portion split by month only when the cycle genuinely straddles two+ budget months.
  const budgetedMonths = familyBudgetedByMonth.filter((m) => m.amount > 0.005);
  const splitByMonth = budgetedMonths.length > 1;
  const multiYear = new Set(budgetedMonths.map((m) => new Date(m.monthISO).getFullYear())).size > 1;
  const monthLabel = (iso: string) =>
    new Date(iso).toLocaleDateString("en-IN", multiYear ? { month: "short", year: "2-digit" } : { month: "short" });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        onClick={() => { setAmount(String(Math.round(suggested))); setOpen(true); }}
        style={{ backgroundColor: color }}
        className={`${CTA_CLASS.window} hover:brightness-95`}
        title="Pay this card bill — opens the pay window"
      >
        <CtaLabel kind="window">Pay</CtaLabel>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/40 sm:items-center sm:p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-t-3xl bg-white shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()} style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h2 className="text-lg font-bold text-slate-900">Pay {cardName} bill</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded-md px-2 text-2xl leading-none text-slate-400 hover:bg-slate-100">✕</button>
            </div>
            <form action={withToast(payFamilyCardBill, { success: "Card bill paid" })} onSubmit={() => setTimeout(() => setOpen(false), 0)} className="space-y-4 px-5 py-5">
              <input type="hidden" name="cardId" value={cardId} />
              <input type="hidden" name="cycleEnd" value={cycleEndISO} />

              <div className="space-y-1.5 rounded-xl p-3" style={{ backgroundColor: `${color}0d` }}>
                <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color }}>Statement · due {due}</p>
                {familyBudgeted > 0.005 && (
                  splitByMonth
                    ? budgetedMonths.map((m) => (
                        <Row key={m.monthISO} label={`⛽ Family — budgeted (${monthLabel(m.monthISO)})`} hint={`from ${monthLabel(m.monthISO)}'s held budget`} value={m.amount} />
                      ))
                    : <Row label="⛽ Family — budgeted" hint="from the held budget" value={familyBudgeted} />
                )}
                {familyMisc > 0.005 && <Row label="🛒 Family — misc / other" hint="from your in-hand" value={familyMisc} />}
                {personalAmount > 0.005 && <Row label="👤 Your spends" hint="from your Can-spend" value={personalAmount} />}
                {annualFee > 0.005 && <Row label="🧾 Annual fee" hint="this month" value={annualFee} />}
                <div className="mt-1.5 border-t border-slate-200 pt-1.5">
                  <Row label="Suggested total" value={suggested} strong />
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-slate-600">Amount paid (₹)</label>
                <input
                  name="amount" type="number" step="0.01" min="0" inputMode="numeric" autoFocus required
                  value={amount} onChange={(e) => setAmount(e.target.value)}
                  style={{ borderColor: color }}
                  className="mt-1.5 w-full rounded-xl border-2 px-4 py-3 text-3xl font-bold tabular-nums outline-none focus:ring-2 focus:ring-slate-100"
                />
                <p className="mt-1 text-[11px] text-slate-400">Defaults to the summed swipes{annualFee > 0.005 ? " + annual fee" : ""}. Edit to the exact statement amount you pay.</p>
                {Math.abs(difference) > 0.005 && (
                  <p className={`mt-1 text-[11px] font-medium ${difference < 0 ? "text-emerald-700" : "text-amber-700"}`}>
                    {difference < 0
                      ? `${formatINR(-difference)} less than the swipes → cashback / savings on this card.`
                      : `${formatINR(difference)} more than the swipes → fees / charges on this card.`}
                  </p>
                )}
              </div>

              {booksDiff && difference > 0.005 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3">
                  <label className="text-sm font-medium text-slate-700">The extra {formatINR(difference)} is spent from</label>
                  <select name="diffCategoryId" required defaultValue={defaultCat} className="input mt-1.5 w-full">
                    <option value="" disabled>Pick a category</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <p className="mt-1 text-[11px] text-slate-500">Booked as a family spend this month (&ldquo;{cardName} bill charges&rdquo;) — it lowers that budget and your In-Hand, and comes out of your family account.</p>
                </div>
              )}
              {booksDiff && difference < -0.005 && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
                  <p className="text-sm font-medium text-slate-700">The {formatINR(-difference)} saved goes to</p>
                  <input type="hidden" name="cashbackTo" value={cashbackTo} />
                  <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                    {([["personal", "👤 My personal income"], ["piggy", "🐷 Piggy"], ["category", "🗂 A category"]] as const).map(([k, l]) => (
                      <button key={k} type="button" onClick={() => setCashbackTo(k)}
                        className={`rounded-lg border-2 px-1.5 py-2 text-[11px] font-medium ${cashbackTo === k ? "border-emerald-500 bg-white text-emerald-700" : "border-slate-200 bg-white text-slate-500"}`}>{l}</button>
                    ))}
                  </div>
                  {cashbackTo === "category" && (
                    <select name="diffCategoryId" required defaultValue={defaultCat} className="input mt-2 w-full">
                      <option value="" disabled>Pick a category</option>
                      {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  )}
                  <p className="mt-1 text-[11px] text-slate-500">
                    {cashbackTo === "personal" ? "Added as income in your personal month." : cashbackTo === "piggy" ? "Added to the general Piggy." : "Credited back to that category this month (raises what's left in it)."}
                  </p>
                </div>
              )}

              <div className="flex items-center gap-3 pt-1">
                <button type="button" onClick={() => setOpen(false)} className="min-h-12 flex-1 rounded-xl border-2 border-slate-200 px-4 py-3 text-base font-medium text-slate-600">Cancel</button>
                <button type="submit" disabled={amountNum < 0 || Number.isNaN(amountNum)} style={{ backgroundColor: color }} className="min-h-12 flex-1 rounded-xl px-4 py-3 text-base font-semibold text-white disabled:opacity-40">
                  Pay bill
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
