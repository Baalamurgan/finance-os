"use client";

import { useEffect, useState } from "react";
import { formatINR } from "@/lib/format";
import { payFamilyCardBill, getMyFeeAccounts } from "@/app/actions";
import { useToastAction } from "@/components/Toast";
import { fx } from "@/components/motion/Fx";
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
  // Who bears card fees, chosen per payment: the annual fee and an extra (late fee / GST…) can each be the
  // family's or the owner's own ("Me" → a personal spend, from the account picked below).
  const [annualBy, setAnnualBy] = useState<"family" | "me">("family");
  const [extraTo, setExtraTo] = useState<"family" | "me">("family");
  const [feeAccounts, setFeeAccounts] = useState<{ id: number; name: string; familyPrimary: boolean }[] | null>(null);
  const [feeFrom, setFeeFrom] = useState<number | "">("");
  const booksDiff = categories.length > 0;
  const due = new Date(dueISO).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  // Show the budgeted portion split by month only when the cycle genuinely straddles two+ budget months.
  const budgetedMonths = familyBudgetedByMonth.filter((m) => m.amount > 0.005);
  const splitByMonth = budgetedMonths.length > 1;
  const multiYear = new Set(budgetedMonths.map((m) => new Date(m.monthISO).getFullYear())).size > 1;
  const monthLabel = (iso: string) =>
    new Date(iso).toLocaleDateString("en-IN", multiYear ? { month: "short", year: "2-digit" } : { month: "short" });

  const myAnnual = annualBy === "me" ? annualFee : 0;
  const myExtra = extraTo === "me" && difference > 0.005 ? difference : 0;
  const myFee = Math.round((myAnnual + myExtra) * 100) / 100;
  // Load the owner's own accounts the first time a "Me" fee is chosen (default: a personal, non-family one).
  useEffect(() => {
    if (myFee <= 0.005 || feeAccounts) return;
    let live = true;
    getMyFeeAccounts().then((a) => { if (!live) return; setFeeAccounts(a); setFeeFrom((f) => f || (a.find((x) => !x.familyPrimary) ?? a[0])?.id || ""); });
    return () => { live = false; };
  }, [myFee, feeAccounts]);

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
          <div className="modal-panel w-full max-w-md rounded-t-3xl bg-white shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()} style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <h2 className="text-lg font-bold text-slate-900">Pay {cardName} bill</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded-md px-2 text-2xl leading-none text-slate-400 hover:bg-slate-100">✕</button>
            </div>
            <form action={withToast(payFamilyCardBill, { success: "Card bill paid", onSuccess: () => fx({ kind: "paid", label: `${cardName} bill` }) })} onSubmit={() => setTimeout(() => setOpen(false), 0)} className="space-y-3 px-5 pt-4">
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
                {annualFee > 0.005 && <Row label="🧾 Annual fee" hint={annualBy === "me" ? "you pay it" : "family pays it"} value={annualFee} />}
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
                  className="mt-1 w-full rounded-xl border-2 px-3 py-2 text-2xl font-bold tabular-nums outline-none focus:ring-2 focus:ring-slate-100"
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

              {annualFee > 0.005 && (
                <div className="rounded-xl border border-slate-200 p-3">
                  <p className="text-sm font-medium text-slate-700">Annual fee {formatINR(annualFee)} is paid by</p>
                  <input type="hidden" name="annualFeeBy" value={annualBy} />
                  <Toggle value={annualBy} onChange={setAnnualBy} />
                </div>
              )}
              {booksDiff && difference > 0.005 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3">
                  <p className="text-sm font-medium text-slate-700">The extra {formatINR(difference)} (late fee / charges) is paid by</p>
                  <input type="hidden" name="extraTo" value={extraTo} />
                  <Toggle value={extraTo} onChange={setExtraTo} />
                  {extraTo === "family" ? (
                    <>
                      <select name="diffCategoryId" required defaultValue={defaultCat} className="input mt-2 w-full">
                        <option value="" disabled>Pick a category</option>
                        {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                      <p className="mt-1 text-[11px] text-slate-500">A family spend this month (&ldquo;{cardName} bill charges&rdquo;) in that category — it lowers that budget and your In-Hand, and comes out of your family account.</p>
                    </>
                  ) : (
                    <p className="mt-1 text-[11px] text-slate-500">Your own card fee — a personal spend (&ldquo;{cardName} card fee&rdquo;) that lowers your Can-spend.</p>
                  )}
                </div>
              )}
              {myFee > 0.005 && (
                <div className="rounded-xl border border-slate-200 p-3">
                  <label className="text-sm font-medium text-slate-700">Your card fee {formatINR(myFee)} is paid from</label>
                  <select name="feeFromAccountId" required value={feeFrom} onChange={(e) => setFeeFrom(e.target.value ? Number(e.target.value) : "")} className="input mt-1.5 w-full">
                    <option value="" disabled>{feeAccounts ? "Pick an account" : "Loading…"}</option>
                    {(feeAccounts ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}{a.familyPrimary ? " · family" : ""}</option>)}
                  </select>
                  <p className="mt-1 text-[11px] text-slate-500">Your family account pays {formatINR(Math.max(0, suggested - myAnnual))}; this account pays your {formatINR(myFee)}.</p>
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

              <div className="modal-foot -mx-5 flex items-center gap-3 border-t border-slate-100 px-5 py-3">
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

// Family / Me segmented choice for who bears a card fee.
function Toggle({ value, onChange }: { value: "family" | "me"; onChange: (v: "family" | "me") => void }) {
  return (
    <div className="mt-1.5 grid grid-cols-2 gap-1.5">
      {([["family", "👨‍👩‍👧 Family"], ["me", "👤 Me · card fee"]] as const).map(([k, l]) => (
        <button key={k} type="button" onClick={() => onChange(k)}
          className={`rounded-lg border-2 px-2 py-2 text-xs font-medium ${value === k ? "border-emerald-500 bg-white text-emerald-700" : "border-slate-200 bg-white text-slate-500"}`}>{l}</button>
      ))}
    </div>
  );
}
