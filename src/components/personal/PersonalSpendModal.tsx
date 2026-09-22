"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { addPersonalSpend, updatePersonalSpend, type PersonalSaveState } from "@/app/personal/actions";
import { useToast } from "@/components/Toast";
import { suggestSpendKind } from "@/lib/spendCategorize";
import { formatINR } from "@/lib/format";
import { currentCycle } from "@/lib/finance/cycle";
import { evalArithmetic, hasArithmeticOp } from "@/lib/calc";
import { PersonalSplitModal, type SplitPerson, type Member } from "@/components/personal/PersonalSplitModal";

type Cat = { id: number; name: string; icon: string | null };
type Card = {
  id: number; name: string; color: string; type?: string; ownerName?: string; mine?: boolean;
  statementDay?: number | null; dueOffsetDays?: number | null;
};
type Initial = { id: number; categoryId: number; amount: number; note: string | null; cardAccountId?: number | null };
const INIT: PersonalSaveState = { ok: false, n: 0 };

const Req = () => <span className="text-red-500"> *</span>;
const toISODate = (d: Date) => {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
};

// Daily spend (category + amount + note), drawn against the remaining balance.
export function PersonalSpendModal({
  periodId,
  categories,
  cards = [],
  members = [],
  remaining,
  initial,
  hideTrigger = false,
  controlledOpen,
  onOpenChange,
}: {
  periodId: number;
  categories: Cat[];
  cards?: Card[];
  members?: Member[];
  remaining?: number;
  initial?: Initial;
  hideTrigger?: boolean;
  controlledOpen?: boolean;
  onOpenChange?: (v: boolean) => void;
}) {
  const isEdit = !!initial;
  const toast = useToast();
  const [uncontrolled, setUncontrolled] = useState(false);
  const open = controlledOpen ?? uncontrolled;
  const setOpen = (v: boolean) => {
    onOpenChange?.(v);
    if (controlledOpen === undefined) setUncontrolled(v);
  };
  const formRef = useRef<HTMLFormElement>(null);
  const prevN = useRef(0);
  const [amount, setAmount] = useState(isEdit ? String(initial!.amount) : "");
  const [note, setNote] = useState(isEdit ? (initial!.note ?? "") : "");
  const [categoryId, setCategoryId] = useState(isEdit ? String(initial!.categoryId) : "");
  const [catTouched, setCatTouched] = useState(isEdit); // don't auto-fill once picked / when editing
  const [splits, setSplits] = useState<SplitPerson[] | null>(null); // others' shares (shared spend)
  const [myShare, setMyShare] = useState(0);
  const [splitOpen, setSplitOpen] = useState(false);
  const [reimburse, setReimburse] = useState(false); // whole spend to receive back (not a split)
  const [reimbSel, setReimbSel] = useState(""); // "" · member id · "other"
  const [cardId, setCardId] = useState(isEdit ? String(initial!.cardAccountId ?? "") : "");
  const selectedCard = cards.find((c) => String(c.id) === cardId);
  const peerCard = selectedCard && selectedCard.mine === false ? selectedCard : null;
  const myCards = cards.filter((c) => c.mine !== false);
  const peerCards = cards.filter((c) => c.mine === false);
  const shared = splits != null;
  // The amount field doubles as a mini-calculator: "120+45*2" evaluates on demand. amountEval is the
  // resolved number (also for a plain "120"); the hidden input submits it, so a raw expression never
  // reaches the server. showCalc reveals the "=" button only when there's an operator to compute.
  const amountEval = evalArithmetic(amount);
  const amountNum = amountEval ?? 0;
  const showCalc = hasArithmeticOp(amount) && amountEval != null;
  const [state, formAction, pending] = useActionState(isEdit ? updatePersonalSpend : addPersonalSpend, INIT);

  // "Collect by" for a split/reimbursement paid on YOUR OWN credit card is auto-derived from that
  // card's cycle (shown disabled). Any other method (cash/UPI, debit/prepaid) → you must pick a date.
  const ownCreditDue = (() => {
    if (!selectedCard || selectedCard.mine === false || selectedCard.type !== "credit_card") return null;
    if (selectedCard.statementDay == null || selectedCard.dueOffsetDays == null) return null;
    return currentCycle(selectedCard.statementDay, new Date(), selectedCard.dueOffsetDays).dueDate ?? null;
  })();
  const needsOwed = shared || reimburse;

  const hasMembers = members.length > 0;
  const reimbMember = members.find((m) => String(m.id) === reimbSel);
  const reimbIsOther = reimbSel === "other";

  const resetShared = () => { setSplits(null); setMyShare(0); };

  useEffect(() => {
    if (state.n > prevN.current) {
      prevN.current = state.n;
      if (state.ok) {
        toast(isEdit ? "Updated" : "Spend added", "success");
        if (!isEdit) {
          formRef.current?.reset();
          setAmount(""); setNote(""); setCategoryId(""); setCatTouched(false);
          resetShared(); setReimburse(false); setReimbSel(""); setCardId("");
        }
        setOpen(false);
      } else toast(state.error ?? "Couldn't save", "error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.n]);

  // Lock the page behind the sheet so scrolling inside it never bleeds to the background (Android
  // scroll-chaining). overscroll-contain on the scroller is the belt; this is the braces.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const calcAmount = () => {
    const r = evalArithmetic(amount);
    if (r == null) { toast("Check the calculation", "error"); return; }
    setAmount(String(r));
    if (shared) resetShared();
  };

  const toggleShared = (checked: boolean) => {
    if (!checked) { resetShared(); return; }
    if (amountNum <= 0) { toast("Enter the amount you paid first", "error"); return; }
    setReimburse(false); setReimbSel(""); // split and reimburse are mutually exclusive
    setSplitOpen(true);
  };

  const toggleReimburse = (checked: boolean) => {
    if (checked) resetShared(); // split and reimburse are mutually exclusive
    setReimburse(checked);
    if (!checked) setReimbSel("");
  };

  return (
    <>
      {!hideTrigger && (
        <button
          onClick={() => setOpen(true)}
          className="w-full rounded-lg bg-emerald-600 px-4 py-3 text-center text-sm font-semibold text-white shadow-sm hover:bg-emerald-700"
        >
          + Add spend
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain bg-black/40 p-4 sm:items-center" onClick={() => setOpen(false)}>
          <div className="my-auto flex w-full max-w-md flex-col rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <h2 className="text-lg font-bold text-slate-900">{isEdit ? "Edit spend" : "Add spend"}</h2>
              <button type="button" onClick={() => setOpen(false)} className="rounded-md px-2 text-slate-400 hover:bg-slate-100" aria-label="Close">
                ✕
              </button>
            </div>
            <form ref={formRef} action={formAction} className="flex flex-col">
              <div className="space-y-4 px-5 py-4">
                <input type="hidden" name="periodId" value={periodId} />
                {isEdit && <input type="hidden" name="id" value={initial!.id} />}
                {shared && (
                  <>
                    <input type="hidden" name="shared" value="on" />
                    <input type="hidden" name="splits" value={JSON.stringify(splits)} />
                    <input type="hidden" name="myShare" value={myShare} />
                  </>
                )}
                {reimburse && (
                  <>
                    <input type="hidden" name="reimburse" value="on" />
                    {reimbMember && <input type="hidden" name="reimburseMemberId" value={reimbMember.id} />}
                  </>
                )}
                <div>
                  <label className="text-xs font-medium text-slate-500">{shared ? "You paid (₹)" : "Amount (₹)"}<Req /></label>
                  {/* the amount is submitted resolved (expression → number) via this hidden field */}
                  <input type="hidden" name="amount" value={amountEval ?? ""} />
                  <div className="relative mt-1">
                    <input
                      type="text" inputMode="decimal" autoFocus required
                      value={amount}
                      onChange={(e) => { setAmount(e.target.value); if (shared) resetShared(); }}
                      placeholder="0"
                      className="w-full rounded-lg border border-slate-300 px-3 py-3 pr-24 text-3xl font-bold tabular-nums outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                    />
                    {showCalc && (
                      <button
                        type="button" onClick={calcAmount}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg bg-emerald-100 px-2.5 py-1.5 text-sm font-bold tabular-nums text-emerald-700 hover:bg-emerald-200"
                      >
                        = {amountEval}
                      </button>
                    )}
                  </div>
                  {remaining !== undefined && !isEdit && (
                    <p className="mt-1 text-xs text-slate-400">Remaining to spend: {formatINR(remaining)}</p>
                  )}
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500">Category<Req /></label>
                  <select
                    name="categoryId" required
                    value={categoryId}
                    onChange={(e) => { setCatTouched(true); setCategoryId(e.target.value); }}
                    className="input mt-1 w-full"
                  >
                    <option value="" disabled>Pick a category</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>{c.icon ? `${c.icon} ` : ""}{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500">Name<Req /></label>
                  <input
                    name="note" required
                    value={note}
                    onChange={(e) => {
                      const v = e.target.value;
                      setNote(v);
                      // auto-pick the category from what's typed (until the user picks one)
                      if (!catTouched) {
                        const k = suggestSpendKind(v);
                        const match = k ? categories.find((c) => c.name === k) : undefined;
                        if (match) setCategoryId(String(match.id));
                      }
                    }}
                    placeholder="e.g. Swiggy dinner"
                    className="input mt-1 w-full"
                  />
                </div>

                {/* Paid with — moved ABOVE the split/reimburse boxes so a credit-card choice can auto-set
                    the collect-by date below. */}
                {cards.length > 0 && (
                  <div>
                    <label className="text-xs font-medium text-slate-500">💳 Paid with</label>
                    <select
                      name="cardAccountId" value={cardId}
                      onChange={(e) => {
                        const v = e.target.value;
                        setCardId(v);
                        // peer card + split/reimburse can't combine — the action rejects it, so clear them
                        if (cards.find((c) => String(c.id) === v && c.mine === false)) { resetShared(); setReimburse(false); setReimbSel(""); }
                      }}
                      className="input mt-1 w-full"
                    >
                      <option value="">Cash / UPI (from this month)</option>
                      {myCards.length > 0 && (
                        <optgroup label="My cards">
                          {myCards.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}{c.type === "credit_card" ? " — pay at card bill" : c.type === "prepaid_card" ? " — from wallet balance" : c.type === "debit_card" ? " — from card balance" : ""}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {peerCards.length > 0 && (
                        <optgroup label="Family members' cards">
                          {peerCards.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name} — {c.ownerName}&apos;s{c.type === "credit_card" ? " credit card" : c.type === "prepaid_card" ? " wallet" : " card"}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                    {peerCard ? (
                      <div className="mt-1.5 space-y-2 rounded-lg bg-amber-50 p-2.5">
                        <p className="text-[11px] leading-relaxed text-amber-800">
                          🤝 {peerCard.ownerName} fronts this — it counts against your month, and you&apos;ll <b>owe {peerCard.ownerName}</b>. Both of you get a reminder before it&apos;s due. Settle it in Lending.
                        </p>
                        {peerCard.type === "credit_card" ? (
                          <p className="text-[11px] text-amber-700">
                            📅 Repay-by is set automatically from {peerCard.ownerName}&apos;s card due date.
                          </p>
                        ) : (
                          <div className="flex flex-wrap items-end gap-2">
                            <label className="flex-1">
                              <span className="text-[11px] font-medium text-amber-800">Repay {peerCard.ownerName} by<Req /></span>
                              <input name="repayBy" type="date" required className="input mt-0.5 w-full py-1.5 text-sm" />
                            </label>
                            <label>
                              <span className="text-[11px] font-medium text-amber-800">Remind (days before)</span>
                              <input name="notifyDaysBefore" type="number" min="0" step="1" defaultValue="3" className="input mt-0.5 w-24 py-1.5 text-sm" />
                            </label>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="mt-1 text-[11px] text-slate-400">
                        It counts against this month either way. A credit card is paid later at its bill; a debit/prepaid card comes off the card&apos;s balance now.{shared ? " Others owe you their shares." : ""}
                      </p>
                    )}
                  </div>
                )}

                {!isEdit && !peerCard && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
                      <input type="checkbox" checked={shared} onChange={(e) => toggleShared(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
                      🤝 Split this spend (I paid, others owe me)
                    </label>
                    {shared && splits && (
                      <div className="mt-3 rounded-lg bg-white p-3 text-sm">
                        <div className="font-medium text-slate-700">Your share {formatINR(myShare)}</div>
                        <ul className="mt-1 space-y-0.5 text-xs text-slate-500">
                          {splits.map((s, i) => (
                            <li key={i} className="flex justify-between"><span>{s.memberId ? "🔗 " : ""}{s.name}</span><span className="tabular-nums">{formatINR(s.amount)}</span></li>
                          ))}
                        </ul>
                        <button type="button" onClick={() => setSplitOpen(true)} className="mt-2 text-xs font-medium text-emerald-700">Edit split</button>
                      </div>
                    )}
                    <label className="mt-2 flex cursor-pointer items-center gap-2 border-t border-slate-200 pt-2 text-sm font-medium text-slate-700">
                      <input type="checkbox" checked={reimburse} onChange={(e) => toggleReimburse(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
                      ↩️ I&apos;ll get this back (reimbursement)
                    </label>
                    {reimburse && (
                      <div className="mt-2 space-y-2 pl-6">
                        <div>
                          <label className="text-[11px] font-medium text-slate-600">Collect from<Req /></label>
                          {hasMembers ? (
                            <>
                              <select value={reimbSel} onChange={(e) => setReimbSel(e.target.value)} required className="input mt-0.5 w-full py-1.5 text-sm">
                                <option value="" disabled>Choose…</option>
                                <optgroup label="Family members">
                                  {members.map((m) => <option key={m.id} value={String(m.id)}>{m.name}</option>)}
                                </optgroup>
                                <option value="other">Someone else (type a name)</option>
                              </select>
                              {reimbIsOther && <input name="reimburseName" required placeholder="Name" className="input mt-1 w-full py-1.5 text-sm" />}
                              {reimbMember && (
                                <p className="mt-1 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-[11px] leading-relaxed text-emerald-800">
                                  🔗 Shows in <b>{reimbMember.name}</b>&apos;s Lending as money they owe you — they get a one-time heads-up. Settling either side clears both.
                                </p>
                              )}
                            </>
                          ) : (
                            <input name="reimburseName" placeholder="Who owes you back?" className="input mt-0.5 w-full py-1.5 text-sm" />
                          )}
                        </div>
                        <p className="text-xs text-slate-500">
                          Adds a “{note.trim() || "this spend"}” receivable for {formatINR(amountNum)} to Lending. It won&apos;t reduce this month&apos;s budget — mark it received when the money comes back.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Collect-by date for a split/reimbursement — auto & locked from your credit card's cycle,
                    otherwise a required manual pick. */}
                {needsOwed && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    {ownCreditDue ? (
                      <div className="flex flex-wrap items-end gap-2">
                        <label className="flex-1">
                          <span className="text-[11px] font-medium text-slate-600">Collect by</span>
                          <input
                            type="date" value={toISODate(ownCreditDue)} disabled readOnly
                            className="input pointer-events-none mt-0.5 w-full bg-slate-100 py-1.5 text-sm text-slate-500"
                          />
                        </label>
                        <label>
                          <span className="text-[11px] font-medium text-slate-600">Remind (days before)</span>
                          <input name="notifyDaysBefore" type="number" min="0" step="1" defaultValue="3" className="input mt-0.5 w-24 py-1.5 text-sm" />
                        </label>
                        <p className="w-full text-[11px] text-slate-400">📅 Auto-set from {selectedCard?.name}&apos;s due date — collect before your bill lands.</p>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-end gap-2">
                        <label className="flex-1">
                          <span className="text-[11px] font-medium text-slate-600">Collect by<Req /></span>
                          <input name="collectBy" type="date" required className="input mt-0.5 w-full py-1.5 text-sm" />
                        </label>
                        <label>
                          <span className="text-[11px] font-medium text-slate-600">Remind (days before)</span>
                          <input name="notifyDaysBefore" type="number" min="0" step="1" defaultValue="3" className="input mt-0.5 w-24 py-1.5 text-sm" />
                        </label>
                        <p className="w-full text-[11px] text-slate-400">Nudges everyone from that many days before — in the bell and top bar — until it&apos;s settled.</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
                <button type="button" onClick={() => setOpen(false)} className="rounded-md px-3 py-2 text-sm text-slate-500 hover:bg-slate-100">Cancel</button>
                <button type="submit" disabled={pending} className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-40">
                  {pending ? "Saving…" : isEdit ? "Save" : "Add"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {splitOpen && (
        <PersonalSplitModal
          total={amountNum}
          initial={splits ?? undefined}
          members={members}
          onClose={() => setSplitOpen(false)}
          onConfirm={(others, mine) => { setSplits(others); setMyShare(mine); setSplitOpen(false); }}
        />
      )}
    </>
  );
}
