"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { editSpendAction, type EditSpendState } from "@/app/actions";

type Mem = { id: number; name: string };
type Card = { id: number; name: string; ownerId: number; ownerName: string; last4: string | null; type: string; color: string };

// Edit a spend in place: same category and date, corrected data — and now the payment method too
// (cash/UPI or a family card). A pencil on the spend row opens this; head edits anyone's, owner their own.
export function EditSpendModal({
  spend,
  categoryName,
  isMisc,
  subCategories,
  isHead,
  members,
  cards = [],
}: {
  spend: { id: number; label: string; amount: number; memberId: number | null; subCategory: string | null; cardAccountId?: number | null };
  categoryName: string;
  isMisc: boolean;
  subCategories?: { name: string; icon: string }[];
  isHead: boolean;
  members?: Mem[];
  cards?: Card[];
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [subCategory, setSubCategory] = useState(spend.subCategory ?? "");
  const [cardId, setCardId] = useState<number | null>(spend.cardAccountId ?? null);
  const [state, formAction, pending] = useActionState<EditSpendState, FormData>(editSpendAction, { ok: false, n: 0 });
  const prevN = useRef(0);
  const selectedCard = cardId != null ? cards.find((c) => c.id === cardId) : undefined;

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // close once a save succeeds (n increments on each successful edit)
  useEffect(() => {
    if (state.n > prevN.current) {
      prevN.current = state.n;
      setOpen(false);
    }
  }, [state.n]);

  const needSub = isMisc && !!subCategories?.length && !subCategory;

  return (
    <>
      <button
        type="button"
        onClick={() => { setSubCategory(spend.subCategory ?? ""); setCardId(spend.cardAccountId ?? null); setOpen(true); }}
        aria-label="Edit spend"
        className="flex h-9 w-9 items-center justify-center rounded-lg text-base text-slate-300 hover:bg-indigo-50 hover:text-indigo-600"
      >
        ✎
      </button>

      {open && mounted &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/40 sm:items-center sm:p-4"
            onClick={() => setOpen(false)}
          >
            <div
              className="flex max-h-[92vh] w-full max-w-md flex-col rounded-t-3xl bg-white shadow-xl sm:my-auto sm:rounded-2xl"
              onClick={(e) => e.stopPropagation()}
              style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
            >
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                <h2 className="text-xl font-bold text-slate-900">
                  Edit spend<span className="text-indigo-600"> · {categoryName}</span>
                </h2>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="-mr-2 rounded-lg px-3 py-2 text-2xl leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>

              <form action={formAction} className="flex min-h-0 flex-col">
                <div className="space-y-5 overflow-y-auto px-5 py-5">
                  <input type="hidden" name="id" value={spend.id} />

                  <div>
                    <label className="text-sm font-medium text-slate-600">Amount (₹)</label>
                    <input
                      name="amount"
                      type="number"
                      step="1"
                      min="0"
                      inputMode="numeric"
                      required
                      defaultValue={spend.amount}
                      className="mt-1.5 w-full rounded-xl border-2 border-slate-300 px-4 py-3 text-4xl font-bold tabular-nums outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                    />
                  </div>

                  {isMisc && subCategories && (
                    <div>
                      <label className="text-sm font-medium text-slate-600">
                        Kind of spend <span className="text-red-500">*</span>
                      </label>
                      <select
                        name="subCategory"
                        required
                        value={subCategory}
                        onChange={(e) => setSubCategory(e.target.value)}
                        className="mt-1.5 w-full rounded-xl border-2 border-slate-300 px-4 py-3 text-base outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                      >
                        <option value="" disabled>Pick a kind…</option>
                        {subCategories.map((s) => (
                          <option key={s.name} value={s.name}>{s.icon} {s.name}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div>
                    <label className="text-sm font-medium text-slate-600">What was bought</label>
                    <input
                      name="label"
                      required
                      defaultValue={spend.label}
                      className="mt-1.5 w-full rounded-xl border-2 border-slate-300 px-4 py-3 text-lg outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                    />
                  </div>

                  {/* Paid with — Cash/UPI or a family card. A card re-attributes the spend to its OWNER. */}
                  <input type="hidden" name="cardAccountId" value={cardId ?? ""} />
                  {cards.length > 0 && (
                    <div>
                      <label className="text-sm font-medium text-slate-600">Paid with</label>
                      <div className="mt-1.5 grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setCardId(null)}
                          className={`min-h-12 rounded-xl border-2 px-3 py-2.5 text-left text-sm font-medium transition ${cardId === null ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-600 active:border-slate-400"}`}
                        >
                          💵 Cash / UPI
                        </button>
                        {cards.map((cCard) => (
                          <button
                            key={cCard.id}
                            type="button"
                            onClick={() => setCardId(cCard.id)}
                            className={`min-h-12 rounded-xl border-2 px-3 py-2.5 text-left transition ${cardId === cCard.id ? "border-indigo-500 bg-indigo-50" : "border-slate-200 active:border-slate-400"}`}
                          >
                            <span className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                              <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: cCard.color }} />
                              <span className="truncate">💳 {cCard.name}{cCard.last4 ? ` XX${cCard.last4}` : ""}</span>
                            </span>
                            <span className="mt-0.5 block truncate text-[11px] text-slate-400">{cCard.ownerName} · {cCard.type === "credit_card" ? "credit" : cCard.type === "prepaid_card" ? "prepaid" : "debit"}</span>
                          </button>
                        ))}
                      </div>
                      {selectedCard && (
                        <p className="mt-1.5 text-xs text-violet-600">Counts as {selectedCard.ownerName}&apos;s spend (card owner).</p>
                      )}
                    </div>
                  )}

                  {/* head-only "who spent" — hidden when a card is chosen (the owner is the payer) */}
                  {cardId == null && isHead && members && members.length > 0 && (
                    <div>
                      <label className="text-sm font-medium text-slate-600">Who spent</label>
                      <select
                        name="memberId"
                        defaultValue={spend.memberId ?? ""}
                        className="mt-1.5 w-full rounded-xl border-2 border-slate-300 px-4 py-3 text-base outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                      >
                        <option value="">Shared</option>
                        {members.map((m) => (
                          <option key={m.id} value={m.id}>{m.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-3 border-t border-slate-100 px-5 py-4">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="min-h-12 flex-1 rounded-xl border-2 border-slate-200 px-4 py-3 text-base font-medium text-slate-600 active:bg-slate-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={needSub || pending}
                    className="min-h-12 flex-1 rounded-xl bg-indigo-600 px-4 py-3 text-base font-semibold text-white shadow-sm active:bg-indigo-800 disabled:opacity-40"
                  >
                    {pending ? "Saving…" : "Save changes"}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
