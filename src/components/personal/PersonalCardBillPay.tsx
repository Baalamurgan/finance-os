"use client";

import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { useSavingToast } from "@/components/useSavingToast";
import { useToast } from "@/components/Toast";
import { formatINR } from "@/lib/format";
import { payCardBillStep, payCardBillFromCard, getPayWindowData, type PersonalSaveState } from "@/app/personal/actions";
import { PaidWithTiles } from "@/components/PaidWithTiles";
import { CTA_CLASS, CtaLabel } from "@/components/Cta";

// The PERSONAL card-bill pay window — one for the Money Plan's card step and for the card itself (Spends /
// Accounts). Same choices as the family pay window for a difference (who bears the annual fee or an extra
// charge, where a saving goes), plus WHICH account the whole bill leaves (default: your personal account)
// and where each share's money sits today — a share sitting elsewhere becomes a transfer step into the paying
// account (or is marked moved right away). The server recomputes every share; the card owner only.
export type PayCardInfo = {
  cardName: string; color: string; dueISO: string | null;
  personal: number; annualFee: number; family: number; familyBudgeted: number; familyMisc: number;
};
export type PayAcct = { id: number; name: string; type: string; color?: string; familyPrimary?: boolean; personalPrimary?: boolean };
type Target = { stepId: number } | { cardId: number; cycleEndISO: string };

const BALANCE_TYPES = new Set(["bank", "cash", "debit_card", "prepaid_card"]);
const r2 = (x: number) => Math.round(x * 100) / 100;

function Row({ label, hint, value, strong }: { label: string; hint?: string; value: number; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-sm">
      <span className={strong ? "font-semibold text-slate-800" : "text-slate-600"}>{label} {hint && <span className="text-[11px] text-slate-400">{hint}</span>}</span>
      <span className={`shrink-0 tabular-nums ${strong ? "font-semibold text-slate-800" : "text-slate-600"}`}>{formatINR(value)}</span>
    </div>
  );
}

function Choice<T extends string>({ value, onChange, options, cols = 2 }: { value: T; onChange: (v: T) => void; options: readonly (readonly [T, string])[]; cols?: 2 | 3 }) {
  return (
    <div className={`mt-1.5 grid gap-1.5 ${cols === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
      {options.map(([k, l]) => (
        <button key={k} type="button" onClick={() => onChange(k)}
          className={`rounded-lg border-2 px-1.5 py-2 text-[11px] font-medium ${value === k ? "border-emerald-500 bg-white text-emerald-700" : "border-slate-200 bg-white text-slate-500"}`}>{l}</button>
      ))}
    </div>
  );
}

function Overlay({ onClose, title, children, hidden }: { onClose: () => void; title: string; children: ReactNode; hidden: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className={`fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/40 sm:items-center sm:p-4${hidden ? " hidden" : ""}`} onClick={onClose}>
      <div className="modal-panel flex w-full max-w-md flex-col rounded-t-3xl bg-white shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()} style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h2 className="text-lg font-bold text-slate-900">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-md px-2 text-slate-400 hover:bg-slate-100" aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// Loads your accounts (unless given) and this month's family categories, then shows the window.
export function PersonalCardBillPayModal({ target, card, accounts, onClose }: { target: Target; card: PayCardInfo; accounts?: PayAcct[]; onClose: () => void }) {
  const [data, setData] = useState<{ accounts: PayAcct[]; categories: { id: number; name: string }[] } | null>(null);
  useEffect(() => {
    let live = true;
    getPayWindowData().then((d) => { if (live) setData(d); }).catch(() => { if (live) setData({ accounts: [], categories: [] }); });
    return () => { live = false; };
  }, []);
  if (!data) return <Overlay hidden={false} onClose={onClose} title={`Pay ${card.cardName} bill`}><p className="px-5 py-6 text-sm text-slate-400">Loading…</p></Overlay>;
  return <PayWindow target={target} card={card} accounts={accounts ?? data.accounts} categories={data.categories} onClose={onClose} />;
}

function PayWindow({ target, card, accounts, categories, onClose }: { target: Target; card: PayCardInfo; accounts: PayAcct[]; categories: { id: number; name: string }[]; onClose: () => void }) {
  const toast = useToast();
  const prevN = useRef(0);
  const swipes = r2(card.personal + card.family);
  const suggested = r2(swipes + card.annualFee);
  const [amount, setAmount] = useState(String(suggested));
  const bankAccts = accounts.filter((a) => BALANCE_TYPES.has(a.type));
  const personalDefault = String((bankAccts.find((a) => a.personalPrimary) ?? (bankAccts.length === 1 ? bankAccts[0] : null))?.id ?? "");
  const familyDefault = String(bankAccts.find((a) => a.familyPrimary)?.id ?? "");
  const [fromId, setFromId] = useState(personalDefault);
  const [familyFromId, setFamilyFromId] = useState(familyDefault);
  const [personalFromId, setPersonalFromId] = useState(personalDefault);
  const [movedNow, setMovedNow] = useState(false); // OFF by default: the transfer steps wait for a tick
  const [annualBy, setAnnualBy] = useState<"family" | "me">("family");
  const [extraTo, setExtraTo] = useState<"family" | "me">("family");
  const [cashbackTo, setCashbackTo] = useState<"personal" | "piggy" | "category">("personal");
  const defaultCat = String(categories.find((c) => /fuel|petrol|diesel/i.test(c.name))?.id ?? "");
  const [catId, setCatId] = useState(defaultCat);
  const action = "stepId" in target ? payCardBillStep : payCardBillFromCard;
  const [state, formAction, saving] = useActionState(action, { ok: false, n: 0 } as PersonalSaveState);
  useSavingToast(saving);
  useEffect(() => {
    if (state.n > prevN.current) {
      prevN.current = state.n;
      if (state.ok) { toast("Card bill paid", "success"); onClose(); } else toast(state.error ?? "Couldn't pay", "error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.n]);

  const amountNum = Number(amount) || 0;
  const diff = r2(amountNum - suggested); // + extra charges · − cashback / saving
  const booksDiff = categories.length > 0;
  const extra = diff > 0.005 ? diff : 0;
  const saved = diff < -0.005 ? -diff : 0;
  // Mirrors the server (payFamilyCardBill → familyShare): the family's spends, the annual fee if it bears it,
  // an extra it bears, less a saving kept on the family side.
  const famExtra = booksDiff && extra && extraTo === "family" && catId ? extra : 0;
  const famSaved = booksDiff && saved && (cashbackTo === "piggy" || (cashbackTo === "category" && catId)) ? saved : 0;
  const familyPart = Math.min(amountNum, Math.max(0, r2(card.family + (annualBy === "family" ? card.annualFee : 0) + famExtra - famSaved)));
  const fromYou = Math.max(0, r2(amountNum - familyPart));
  const nameOf = (id: string) => bankAccts.find((a) => String(a.id) === id)?.name ?? "?";
  const moves = [
    familyPart > 0.005 && familyFromId && familyFromId !== fromId ? { from: familyFromId, amt: familyPart, what: "family share" } : null,
    fromYou > 0.005 && personalFromId && personalFromId !== fromId ? { from: personalFromId, amt: fromYou, what: "your share" } : null,
  ].filter((m): m is { from: string; amt: number; what: string } => m != null);
  const due = card.dueISO ? new Date(card.dueISO).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : null;
  const catSelect = (
    <select name="diffCategoryId" required value={catId} onChange={(e) => setCatId(e.target.value)} className="input mt-2 w-full">
      <option value="" disabled>Pick a category</option>
      {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  );
  const blocked = Number.isNaN(amountNum) || amountNum < 0 || (bankAccts.length > 0 && (!fromId || (familyPart > 0.005 && !familyFromId) || (fromYou > 0.005 && !personalFromId)));

  return (
    <Overlay hidden={saving} onClose={onClose} title={`Pay ${card.cardName} bill`}>
      <form action={formAction} className="space-y-3 px-5 pt-3">
        {"stepId" in target ? <input type="hidden" name="id" value={target.stepId} /> : (
          <>
            <input type="hidden" name="cardId" value={target.cardId} />
            <input type="hidden" name="cycleEnd" value={target.cycleEndISO} />
          </>
        )}
        <details className="group rounded-xl px-3 py-2" style={{ backgroundColor: `${card.color}0d` }}>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
            <span className="min-w-0">
              <span className="block text-[11px] font-semibold uppercase tracking-wide" style={{ color: card.color }}>Statement{due ? ` · due ${due}` : ""}</span>
              <span className="block truncate text-[11px] text-slate-500">👪 {formatINR(card.family)} · 👤 {formatINR(card.personal)}{card.annualFee > 0.005 ? ` · 🧾 ${formatINR(card.annualFee)}` : ""}</span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5 text-base font-bold tabular-nums text-slate-800">{formatINR(suggested)}<span className="text-[10px] text-slate-400 transition-transform group-open:rotate-180">▾</span></span>
          </summary>
          <div className="mt-2 space-y-1.5">
          <div className="rounded-lg bg-white/70 p-2">
            <Row label="👪 Family spends" hint="taken from family In-Hand" value={card.family} strong />
            {card.family > 0.005 && (
              <div className="ml-4 mt-0.5 space-y-0.5 text-xs">
                {card.familyBudgeted > 0.005 && <Row label="⛽ budgeted" hint="from the held budget" value={card.familyBudgeted} />}
                {card.familyMisc > 0.005 && <Row label="🛒 misc / other" hint="from your in-hand" value={card.familyMisc} />}
              </div>
            )}
          </div>
          <div className="rounded-lg bg-white/70 p-2">
            <Row label="👤 Your spends" hint="from your account" value={card.personal} strong />
          </div>
          {card.annualFee > 0.005 && <Row label="🧾 Annual fee" hint={annualBy === "me" ? "you pay it" : "family pays it"} value={card.annualFee} />}
          </div>
        </details>

        <div>
          <label className="text-sm font-medium text-slate-600">Amount you paid (₹)</label>
          <input name="amount" type="number" step="0.01" min="0" inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} style={{ borderColor: card.color }} className="mt-1 w-full rounded-xl border-2 px-3 py-2 text-xl font-bold tabular-nums outline-none" />
          {Math.abs(diff) > 0.005 && (
            <p className={`mt-1 text-[11px] font-medium ${diff < 0 ? "text-emerald-700" : "text-amber-700"}`}>
              {diff < 0 ? `${formatINR(-diff)} less than the statement → cashback / savings on this card.` : `${formatINR(diff)} more than the statement → fees / charges on this card.`}
            </p>
          )}
        </div>

        {card.annualFee > 0.005 && (
          <div className="rounded-xl border border-slate-200 p-3">
            <p className="text-sm font-medium text-slate-700">Annual fee {formatINR(card.annualFee)} is paid by</p>
            <input type="hidden" name="annualFeeBy" value={annualBy} />
            <Choice value={annualBy} onChange={setAnnualBy} options={[["family", "👨‍👩‍👧 Family"], ["me", "👤 Me · card fee"]] as const} />
            {annualBy === "me" && <p className="mt-1 text-[11px] text-slate-500">Your own card fee — a personal spend (&ldquo;{card.cardName} card fee&rdquo;) that lowers your Can-spend.</p>}
          </div>
        )}
        {booksDiff && extra > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3">
            <p className="text-sm font-medium text-slate-700">The extra {formatINR(extra)} (late fee / charges) is paid by</p>
            <input type="hidden" name="extraTo" value={extraTo} />
            <Choice value={extraTo} onChange={setExtraTo} options={[["family", "👨‍👩‍👧 Family"], ["me", "👤 Me · card fee"]] as const} />
            {extraTo === "family" ? (
              <>
                {catSelect}
                <p className="mt-1 text-[11px] text-slate-500">A family spend this month (&ldquo;{card.cardName} bill charges&rdquo;) in that category — it lowers that budget and the family In-Hand, and is part of the family share below.</p>
              </>
            ) : (
              <p className="mt-1 text-[11px] text-slate-500">Your own card fee — a personal spend (&ldquo;{card.cardName} card fee&rdquo;) that lowers your Can-spend.</p>
            )}
          </div>
        )}
        {booksDiff && saved > 0 && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
            <p className="text-sm font-medium text-slate-700">The {formatINR(saved)} saved goes to</p>
            <input type="hidden" name="cashbackTo" value={cashbackTo} />
            <Choice cols={3} value={cashbackTo} onChange={setCashbackTo} options={[["personal", "👤 My personal income"], ["piggy", "🐷 Piggy"], ["category", "🗂 A category"]] as const} />
            {cashbackTo === "category" && catSelect}
            <p className="mt-1 text-[11px] text-slate-500">
              {cashbackTo === "personal" ? "Added as income in your personal month." : cashbackTo === "piggy" ? "Added to the general Piggy — the family share is that much smaller." : "Credited back to that category this month — the family share is that much smaller."}
            </p>
          </div>
        )}

        {bankAccts.length > 0 && (
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium text-slate-600">Paid the whole bill from</label>
              <div className="mt-1.5">
                <PaidWithTiles
                  name="fromAccountId"
                  value={fromId}
                  onChange={setFromId}
                  options={bankAccts.map((a) => ({ value: String(a.id), title: a.name, type: a.type, color: a.color, sub: a.personalPrimary ? "your personal account" : a.familyPrimary ? "your family account" : undefined }))}
                />
              </div>
              <p className="mt-1 text-[11px] text-slate-500">{formatINR(amountNum)} leaves {fromId ? nameOf(fromId) : "that account"}.</p>
            </div>
            <div className="rounded-xl border border-slate-200 p-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Who pays what</p>
              <div className="mt-1 grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-[11px] font-medium text-slate-500">👪 Family share {formatINR(familyPart)}{familyPart > 0.005 ? " is in" : ""}</span>
                  {familyPart > 0.005 && (
                    <select name="familyFromId" required value={familyFromId} onChange={(e) => setFamilyFromId(e.target.value)} className="input mt-1 w-full py-1.5 text-sm">
                      <option value="" disabled>Pick</option>
                      {bankAccts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  )}
                </label>
                <label className="block">
                  <span className="text-[11px] font-medium text-slate-500">👤 Your share {formatINR(fromYou)}{fromYou > 0.005 ? " is in" : ""}</span>
                  {fromYou > 0.005 && (
                    <select name="personalFromId" required value={personalFromId} onChange={(e) => setPersonalFromId(e.target.value)} className="input mt-1 w-full py-1.5 text-sm">
                      <option value="" disabled>Pick</option>
                      {bankAccts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  )}
                </label>
              </div>
            </div>
            {fromId && moves.length > 0 && (
              <div className="rounded-lg bg-sky-50 p-2.5 text-[12px] text-sky-900">
                <p className="font-medium">Adds {moves.length === 1 ? "a step" : "steps"} to your Money Plan:</p>
                <ul className="mt-0.5 space-y-0.5">
                  {moves.map((m) => <li key={m.what}>↔ {nameOf(m.from)} → {nameOf(fromId)} · {formatINR(m.amt)} <span className="text-sky-700">({m.what})</span></li>)}
                </ul>
                <label className="mt-1.5 flex cursor-pointer items-center gap-2 text-[12px] font-medium text-sky-900">
                  <input type="checkbox" name="movedNow" checked={movedNow} onChange={(e) => setMovedNow(e.target.checked)} className="h-4 w-4 accent-sky-600" />
                  Already moved — mark {moves.length === 1 ? "it" : "them"} done now
                </label>
                {!movedNow && <p className="mt-0.5 text-[11px] text-sky-700">{moves.length === 1 ? "It waits" : "They wait"} in your plan — tick when you move the money; balances follow.</p>}
              </div>
            )}
          </div>
        )}
        <div className="modal-foot -mx-5 flex items-center gap-3 border-t border-slate-100 px-5 py-3">
          <button type="button" onClick={onClose} className="min-h-11 flex-1 rounded-xl border-2 border-slate-200 px-4 py-2 text-base font-medium text-slate-600">Cancel</button>
          <button type="submit" disabled={blocked} style={{ backgroundColor: card.color }} className="min-h-11 flex-1 rounded-xl px-4 py-2 text-base font-semibold text-white disabled:opacity-40">Pay bill</button>
        </div>
      </form>
    </Overlay>
  );
}

// The "Pay" button on a card's bill (Spends / Accounts → Cards), opening the personal pay window.
export function PersonalPayCardBillButton({ cardId, cycleEndISO, card }: { cardId: number; cycleEndISO: string; card: PayCardInfo }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} style={{ backgroundColor: card.color }} className={`${CTA_CLASS.window} hover:brightness-95`} title="Pay this card bill — opens the pay window">
        <CtaLabel kind="window">Pay</CtaLabel>
      </button>
      {open && <PersonalCardBillPayModal target={{ cardId, cycleEndISO }} card={card} onClose={() => setOpen(false)} />}
    </>
  );
}
