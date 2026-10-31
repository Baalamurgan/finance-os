"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { upsertPersonalRecurring, deletePersonalRecurring, type PersonalSaveState } from "@/app/personal/actions";
import { useToast } from "@/components/Toast";
import { formatINR } from "@/lib/format";

type Cat = { id: number; name: string; icon: string | null };
type Card = { id: number; name: string; color: string };
type Acct = { id: number; name: string };
export type RecurringKind = "income" | "expense" | "spend";
export type RecurringItem = { id: number; label: string; amount: number; day: number; categoryId: number | null; cardAccountId: number | null; accountId: number | null };
const INIT: PersonalSaveState = { ok: false, n: 0 };
const NOUN: Record<RecurringKind, string> = { income: "income", expense: "expense", spend: "spend" };

// Add / edit one recurring template. The same server action (upsertPersonalRecurring) handles every kind;
// `kind` decides which fields show — income has no category/card, expense & spend do.
function RecurringModal({ kind, periodId, categories, cards, accounts, initial, open, setOpen }: {
  kind: RecurringKind; periodId: number; categories: Cat[]; cards: Card[]; accounts: Acct[];
  initial?: RecurringItem; open: boolean; setOpen: (v: boolean) => void;
}) {
  const isEdit = !!initial;
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const prevN = useRef(0);
  const [state, formAction, pending] = useActionState(upsertPersonalRecurring, INIT);
  useEffect(() => {
    if (state.n > prevN.current) {
      prevN.current = state.n;
      if (state.ok) { toast(isEdit ? "Saved" : "Added", "success"); if (!isEdit) formRef.current?.reset(); setOpen(false); }
      else toast(state.error ?? "Couldn't save", "error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.n]);
  if (!open) return null;
  const nameLabel = kind === "income" ? "Source" : "Name";
  const namePh = kind === "income" ? "e.g. Salary, Rent received" : kind === "expense" ? "e.g. Rent, Netflix" : "e.g. Gym, Daily chai";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center" onClick={() => setOpen(false)}>
      <div className="my-auto flex w-full max-w-md flex-col rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h2 className="text-lg font-bold text-slate-900">{isEdit ? "Edit" : "Add"} recurring {NOUN[kind]}</h2>
          <button type="button" onClick={() => setOpen(false)} className="rounded-md px-2 text-slate-400 hover:bg-slate-100" aria-label="Close">✕</button>
        </div>
        <form ref={formRef} action={formAction} className="flex flex-col">
          <div className="space-y-4 px-5 py-4">
            <input type="hidden" name="kind" value={kind} />
            <input type="hidden" name="periodId" value={periodId} />
            {isEdit && <input type="hidden" name="id" value={initial!.id} />}
            <div>
              <label className="text-xs font-medium text-slate-500">{nameLabel}</label>
              <input name="label" required defaultValue={initial?.label ?? ""} placeholder={namePh} className="input mt-1 w-full" />
            </div>
            {kind !== "income" && (
              <div>
                <label className="text-xs font-medium text-slate-500">Category</label>
                <select name="categoryId" required defaultValue={initial?.categoryId ? String(initial.categoryId) : ""} className="input mt-1 w-full">
                  <option value="" disabled>Pick a category</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.icon ? `${c.icon} ` : ""}{c.name}</option>)}
                </select>
              </div>
            )}
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs font-medium text-slate-500">Amount (₹)</label>
                <input name="amount" type="number" step="0.01" inputMode="decimal" required defaultValue={initial?.amount ?? ""} placeholder="0" className="input mt-1 w-full" />
              </div>
              <div className="w-28">
                <label className="text-xs font-medium text-slate-500">Day of month</label>
                <input name="day" type="number" min={1} max={28} required defaultValue={initial?.day ?? 1} className="input mt-1 w-full" />
              </div>
            </div>
            {kind === "income" && accounts.length > 0 && (
              <div>
                <label className="text-xs font-medium text-slate-500">💰 Deposited into (optional)</label>
                <select name="accountId" defaultValue={initial?.accountId ? String(initial.accountId) : ""} className="input mt-1 w-full">
                  <option value="">Budget only (no account)</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <p className="mt-1 text-[11px] text-slate-400">Shows on your plan as an &ldquo;income received&rdquo; step; ticking it credits this account.</p>
              </div>
            )}
            {kind !== "income" && cards.length > 0 && (
              <div>
                <label className="text-xs font-medium text-slate-500">💳 Paid with</label>
                <select name="cardAccountId" defaultValue={initial?.cardAccountId ? String(initial.cardAccountId) : ""} className="input mt-1 w-full">
                  <option value="">Cash / UPI</option>
                  {cards.map((c) => <option key={c.id} value={c.id}>{c.name} — pay at card bill</option>)}
                </select>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
            <button type="button" onClick={() => setOpen(false)} className="rounded-md px-3 py-2 text-sm text-slate-500 hover:bg-slate-100">Cancel</button>
            <button type="submit" disabled={pending} className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-40">{pending ? "Saving…" : isEdit ? "Save" : "Add"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// One setup section for a recurring kind: the list (with edit/delete) + an "add" button. `day` is shown as
// a chip so you can see when each lands. A read-only list shows when there's no open month to add into.
export function PersonalRecurringSection({ kind, title, hint, items, periodId, categories, cards, accounts }: {
  kind: RecurringKind; title: string; hint: string; items: RecurringItem[];
  periodId: number | null; categories: Cat[]; cards: Card[]; accounts: Acct[];
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<RecurringItem | null>(null);
  const catOf = (id: number | null) => (id == null ? null : categories.find((c) => c.id === id));

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      <p className="mt-0.5 text-xs text-slate-500">{hint}</p>
      <div className="mt-3 divide-y divide-slate-100">
        {items.length === 0 ? (
          <p className="py-2 text-sm text-slate-400">None yet.</p>
        ) : (
          items.map((e) => (
            <div key={e.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <span className="flex min-w-0 items-center gap-1.5 truncate text-slate-700">
                <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-slate-500" title="Day of month">{e.day}</span>
                <span className="truncate">{catOf(e.categoryId)?.icon} {e.label}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="tabular-nums font-medium text-slate-800">{formatINR(e.amount)}</span>
                {periodId != null && (
                  <button type="button" onClick={() => setEditing(e)} className="rounded-md border border-slate-200 px-2 py-0.5 text-xs text-slate-500 hover:bg-slate-100">Edit</button>
                )}
                <form action={deletePersonalRecurring}>
                  <input type="hidden" name="kind" value={kind} />
                  <input type="hidden" name="id" value={e.id} />
                  <button type="submit" className="rounded-md px-1.5 py-0.5 text-sm text-slate-300 hover:text-red-600" aria-label="Delete">✕</button>
                </form>
              </span>
            </div>
          ))
        )}
      </div>
      {periodId != null && (
        <>
          <button type="button" onClick={() => setAdding(true)} className="mt-3 w-full rounded-lg border border-dashed border-emerald-300 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50">
            + Add recurring {NOUN[kind]}
          </button>
          <RecurringModal kind={kind} periodId={periodId} categories={categories} cards={cards} accounts={accounts} open={adding} setOpen={setAdding} />
          {editing && (
            <RecurringModal key={editing.id} kind={kind} periodId={periodId} categories={categories} cards={cards} accounts={accounts} initial={editing} open setOpen={(v) => { if (!v) setEditing(null); }} />
          )}
        </>
      )}
    </section>
  );
}
