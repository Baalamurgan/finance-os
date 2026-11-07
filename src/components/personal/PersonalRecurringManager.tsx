"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useSavingToast } from "@/components/useSavingToast";
import { upsertPersonalRecurring, deletePersonalRecurring, applyTemplateToMonth, type PersonalSaveState } from "@/app/personal/actions";
import { ApplyToMonth, type MonthNote } from "@/components/personal/ApplyToMonth";
import { HoldingPicker } from "@/components/personal/HoldingPicker";
import { useToast } from "@/components/Toast";
import { formatINR } from "@/lib/format";

type Cat = { id: number; name: string; icon: string | null; bucket?: string | null };
type HoldingOpt = { id: number; name: string };
type PayAcct = { id: number; name: string; type: string };
const PAY_GROUPS: { label: string; types: string[] }[] = [
  { label: "Bank / UPI", types: ["bank"] },
  { label: "Cash", types: ["cash"] },
  { label: "Debit / prepaid cards", types: ["debit_card", "prepaid_card"] },
  { label: "Credit cards — pay at card bill", types: ["credit_card"] },
];
type Acct = { id: number; name: string };
export type RecurringKind = "income" | "expense" | "spend";
// cardAccountId = the account a bill/spend is PAID FROM (any bank, cash or card); accountId = where an income lands.
// `month` = this month's own copy vs. the template (null = no month to compare against).
export type RecurringItem = { id: number; label: string; amount: number; day: number; categoryId: number | null; cardAccountId: number | null; accountId: number | null; holdingId?: number | null; month?: MonthNote | null };
const INIT: PersonalSaveState = { ok: false, n: 0 };
const NOUN: Record<RecurringKind, string> = { income: "income", expense: "expense", spend: "spend" };

// Add / edit one recurring template. The same server action (upsertPersonalRecurring) handles every kind;
// `kind` decides which fields show — income has no category/card, expense & spend do.
function RecurringModal({ kind, periodId, categories, payAccounts, accounts, holdings, initial, open, setOpen }: {
  kind: RecurringKind; periodId: number | null; categories: Cat[]; payAccounts: PayAcct[]; accounts: Acct[]; holdings: HoldingOpt[];
  initial?: RecurringItem; open: boolean; setOpen: (v: boolean) => void;
}) {
  const isEdit = !!initial;
  // An Invest-category bill/spend can feed a net-worth holding: each payment ticked adds to it.
  const [catId, setCatId] = useState(initial?.categoryId ? String(initial.categoryId) : "");
  const isInvest = categories.find((c) => String(c.id) === catId)?.bucket === "invest";
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const prevN = useRef(0);
  const [state, formAction, pending] = useActionState(upsertPersonalRecurring, INIT);
  useSavingToast(pending); // hide + "Saving…" while the server works; the result toast replaces it
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
    <div className={`fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center${pending ? " hidden" : ""}`} onClick={() => setOpen(false)}>
      <div className="modal-panel my-auto flex w-full max-w-md flex-col rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h2 className="text-lg font-bold text-slate-900">{isEdit ? "Edit" : "Add"} recurring {NOUN[kind]}</h2>
          <button type="button" onClick={() => setOpen(false)} className="rounded-md px-2 text-slate-400 hover:bg-slate-100" aria-label="Close">✕</button>
        </div>
        <form ref={formRef} action={formAction} className="flex flex-col">
          <div className="space-y-4 px-5 py-4">
            <input type="hidden" name="kind" value={kind} />
            {periodId != null && <input type="hidden" name="periodId" value={periodId} />}
            {isEdit && <input type="hidden" name="id" value={initial!.id} />}
            <div>
              <label className="text-xs font-medium text-slate-500">{nameLabel}</label>
              <input name="label" required defaultValue={initial?.label ?? ""} placeholder={namePh} className="input mt-1 w-full" />
            </div>
            {kind !== "income" && (
              <div>
                <label className="text-xs font-medium text-slate-500">Category</label>
                <select name="categoryId" required value={catId} onChange={(e) => setCatId(e.target.value)} className="input mt-1 w-full">
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
            {kind !== "income" && payAccounts.length > 0 && (
              <div>
                <label className="text-xs font-medium text-slate-500">Paid from</label>
                <select name="payAccountId" defaultValue={initial?.cardAccountId ? String(initial.cardAccountId) : ""} className="input mt-1 w-full">
                  <option value="">Not set — ask me when I mark it paid</option>
                  {PAY_GROUPS.map((g) => {
                    const list = payAccounts.filter((a) => g.types.includes(a.type));
                    return list.length === 0 ? null : (
                      <optgroup key={g.label} label={g.label}>
                        {list.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </optgroup>
                    );
                  })}
                </select>
                <p className="mt-1 text-[11px] text-slate-400">Any of your accounts. Marking the step done in your plan debits it (a credit card settles at its bill).</p>
              </div>
            )}
            {kind !== "income" && isInvest && (
              <HoldingPicker holdings={holdings} initialId={initial?.holdingId} suggestedName={initial?.label ?? ""} />
            )}
          </div>
          <div className="modal-foot flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
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
export function PersonalRecurringSection({ kind, title, hint, items, periodId, categories, payAccounts, accounts, holdings = [] }: {
  kind: RecurringKind; title: string; hint: string; items: RecurringItem[];
  periodId: number | null; categories: Cat[]; payAccounts: PayAcct[]; accounts: Acct[]; holdings?: HoldingOpt[];
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
            <div key={e.id} className="py-2 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5 truncate text-slate-700">
                <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-slate-500" title="Day of month">{e.day}</span>
                <span className="truncate">{catOf(e.categoryId)?.icon} {e.label}</span>
                {e.holdingId && <span className="shrink-0 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700" title="Adds to this net-worth holding when ticked">📈 {holdings.find((h) => h.id === e.holdingId)?.name ?? "holding"}</span>}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="tabular-nums font-medium text-slate-800">{formatINR(e.amount)}</span>
                <button type="button" onClick={() => setEditing(e)} className="rounded-md border border-slate-200 px-2 py-0.5 text-xs text-slate-500 hover:bg-slate-100">Edit</button>
                <form action={deletePersonalRecurring}>
                  <input type="hidden" name="kind" value={kind} />
                  <input type="hidden" name="id" value={e.id} />
                  <button type="submit" className="rounded-md px-1.5 py-0.5 text-sm text-slate-300 hover:text-red-600" aria-label="Delete" title="Stop repeating from next month (this month's copy stays)">✕</button>
                </form>
              </span>
            </div>
            <ApplyToMonth note={e.month ?? null} id={e.id} periodId={periodId} action={applyTemplateToMonth} />
            </div>
          ))
        )}
      </div>
      {(
        <>
          <button type="button" onClick={() => setAdding(true)} className="mt-3 w-full rounded-lg border border-dashed border-emerald-300 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50">
            + Add recurring {NOUN[kind]}
          </button>
          <RecurringModal kind={kind} periodId={periodId} categories={categories} payAccounts={payAccounts} accounts={accounts} holdings={holdings} open={adding} setOpen={setAdding} />
          {editing && (
            <RecurringModal key={editing.id} kind={kind} periodId={periodId} categories={categories} payAccounts={payAccounts} accounts={accounts} holdings={holdings} initial={editing} open setOpen={(v) => { if (!v) setEditing(null); }} />
          )}
        </>
      )}
    </section>
  );
}
