"use client";

import { useState } from "react";
import { formatINR } from "@/lib/format";
import { ConfirmForm } from "@/components/ConfirmForm";
import { createRecurringItem, updateRecurringItem, deleteRecurringItem, toggleRecurringActive } from "@/app/actions";

export type RItem = {
  id: number; kind: "income" | "expense"; name: string; amount: number;
  categoryId: number | null; section: string; memberId: number | null; memberName: string | null; active: boolean;
  installmentsTotal: number | null; installmentCurrent: number | null;
};
export type CatOpt = { id: number; name: string; section: string };
export type MemberOpt = { id: number; name: string };

const SECTIONS = ["Loans", "Chits", "Monthly", "Misc"] as const;
const SECTION_LABEL: Record<string, string> = { Loans: "Loans", Chits: "Chits", Monthly: "Monthly", Misc: "Miscellaneous" };

export function RecurringSetup({
  items, categories, members, householdId, readOnly,
}: {
  items: RItem[]; categories: CatOpt[]; members: MemberOpt[]; householdId: number; readOnly: boolean;
}) {
  const [byMember, setByMember] = useState(false);
  const income = items.filter((i) => i.kind === "income");
  const expenses = items.filter((i) => i.kind === "expense");
  const memberNames = Array.from(new Set(items.map((i) => i.memberName))).sort((a, b) => (a ?? "~").localeCompare(b ?? "~"));

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">🔁 Recurring template</h2>
          <p className="text-xs text-slate-500">The source of truth — every month is generated from these. Edits apply from next month.</p>
        </div>
        <div className="inline-flex rounded-lg border border-slate-200 p-0.5 text-xs font-medium">
          <button onClick={() => setByMember(false)} className={`rounded-md px-2.5 py-1 ${!byMember ? "bg-indigo-600 text-white" : "text-slate-500"}`}>By type</button>
          <button onClick={() => setByMember(true)} className={`rounded-md px-2.5 py-1 ${byMember ? "bg-indigo-600 text-white" : "text-slate-500"}`}>By member</button>
        </div>
      </div>

      <div className="divide-y divide-slate-100">
        {byMember ? (
          memberNames.map((m) => {
            const rows = items.filter((i) => i.memberName === m);
            const net = rows.reduce((s, i) => s + (i.kind === "income" ? i.amount : -i.amount), 0);
            return (
              <Group key={m ?? "shared"} title={m ?? "Shared / pool"} note={`net ${formatINR(net)}`}>
                {rows.map((i) => <ItemRow key={i.id} item={i} members={members} categories={categories} readOnly={readOnly} />)}
              </Group>
            );
          })
        ) : (
          <>
            <Group title="Income" note={formatINR(income.reduce((s, i) => s + i.amount, 0))}>
              {income.length === 0 ? <Empty /> : income.map((i) => <ItemRow key={i.id} item={i} members={members} categories={categories} readOnly={readOnly} />)}
            </Group>
            {SECTIONS.map((sec) => {
              const rows = expenses.filter((e) => e.section === sec);
              if (rows.length === 0) return null;
              return (
                <Group key={sec} title={SECTION_LABEL[sec]} note={formatINR(rows.reduce((s, e) => s + e.amount, 0))}>
                  {rows.map((e) => <ItemRow key={e.id} item={e} members={members} categories={categories} readOnly={readOnly} />)}
                </Group>
              );
            })}
          </>
        )}
      </div>

      {!readOnly && <AddItem householdId={householdId} categories={categories} members={members} />}
    </section>
  );
}

function Group({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <details open className="group">
      <summary className="flex cursor-pointer list-none items-center justify-between bg-slate-50/60 px-4 py-2 [&::-webkit-details-marker]:hidden">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{title}</span>
        {note && <span className="text-xs font-medium tabular-nums text-slate-500">{note}</span>}
      </summary>
      <div className="divide-y divide-slate-100 px-2">{children}</div>
    </details>
  );
}
function Empty() {
  return <p className="px-2 py-3 text-xs text-slate-400">Nothing here yet — add below.</p>;
}

function ItemRow({ item, members, categories, readOnly }: { item: RItem; members: MemberOpt[]; categories: CatOpt[]; readOnly: boolean }) {
  const [name, setName] = useState(item.name);
  const [amount, setAmount] = useState(String(item.amount));
  const [memberId, setMemberId] = useState(item.memberId != null ? String(item.memberId) : "");
  const [categoryId, setCategoryId] = useState(item.categoryId != null ? String(item.categoryId) : "");
  const [instTotal, setInstTotal] = useState(item.installmentsTotal != null ? String(item.installmentsTotal) : "");
  const [instCurrent, setInstCurrent] = useState(item.installmentCurrent != null ? String(item.installmentCurrent) : "");
  const baseTotal = item.installmentsTotal != null ? String(item.installmentsTotal) : "";
  const baseCurrent = item.installmentCurrent != null ? String(item.installmentCurrent) : "";
  const dirty =
    name !== item.name || amount !== String(item.amount) ||
    memberId !== (item.memberId != null ? String(item.memberId) : "") ||
    categoryId !== (item.categoryId != null ? String(item.categoryId) : "") ||
    instTotal !== baseTotal || instCurrent !== baseCurrent;
  const invalid = !name.trim() || !amount || Number(amount) <= 0;

  if (readOnly) {
    return (
      <div className="flex items-center justify-between gap-2 py-2 pl-2 text-sm">
        <span className="truncate text-slate-700">
          {item.name}
          {item.installmentsTotal != null && item.installmentCurrent != null && <span className="ml-1.5 text-[11px] text-indigo-500">{item.installmentCurrent}/{item.installmentsTotal}</span>}
          {item.memberName ? <span className="ml-1.5 text-[11px] text-slate-400">· {item.memberName}</span> : null}
        </span>
        <span className="tabular-nums text-slate-700">{formatINR(item.amount)}</span>
      </div>
    );
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 py-2 pl-2 pr-1 text-sm ${item.active ? "" : "opacity-50"}`}>
      <input value={name} onChange={(e) => setName(e.target.value)} className="input w-40 py-1 text-sm" />
      {item.installmentsTotal != null && item.installmentCurrent != null && (
        <span className="rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-500" title="installment (this month / total)">
          {item.installmentCurrent}/{item.installmentsTotal}
        </span>
      )}
      <div className="flex items-center gap-1">
        <span className="text-slate-400">₹</span>
        <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="input w-24 py-1 text-sm" />
      </div>
      <select value={memberId} onChange={(e) => setMemberId(e.target.value)} className="input w-28 py-1 text-xs" title={item.kind === "income" ? "owner" : "who pays"}>
        <option value="">{item.kind === "income" ? "Owner…" : "Shared"}</option>
        {members.map((m) => <option key={m.id} value={String(m.id)}>{m.name}</option>)}
      </select>
      {item.kind === "expense" && (
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="input w-32 py-1 text-xs" title="category">
          {categories.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
        </select>
      )}
      <label className="flex items-center gap-1 text-[11px] text-slate-500" title="Installment: repeats N times then stops. Leave total blank for a normal repeat.">
        EMI
        <input type="number" min="0" value={instTotal} onChange={(e) => setInstTotal(e.target.value)} placeholder="×" className="input w-12 py-1 text-xs" title="total payments" />
        {instTotal && Number(instTotal) > 0 && (
          <>
            <span>on</span>
            <input type="number" min="1" value={instCurrent} onChange={(e) => setInstCurrent(e.target.value)} placeholder="#" className="input w-12 py-1 text-xs" title="which payment is THIS month" />
          </>
        )}
      </label>
      <div className="ml-auto flex items-center gap-1">
        <form action={updateRecurringItem}>
          <input type="hidden" name="id" value={item.id} />
          <input type="hidden" name="name" value={name} />
          <input type="hidden" name="amount" value={amount} />
          <input type="hidden" name="memberId" value={memberId} />
          <input type="hidden" name="categoryId" value={categoryId} />
          <input type="hidden" name="installmentsTotal" value={instTotal} />
          <input type="hidden" name="installmentCurrent" value={instCurrent || "1"} />
          <button disabled={!dirty || invalid} className="btn px-2 py-1 text-xs disabled:opacity-40">Save</button>
        </form>
        <form action={toggleRecurringActive} title={item.active ? "Active — click to pause" : "Paused — click to activate"}>
          <input type="hidden" name="id" value={item.id} />
          <button className={`rounded-md px-2 py-1 text-xs ${item.active ? "text-slate-500 hover:bg-slate-100" : "text-amber-600 hover:bg-amber-50"}`}>
            {item.active ? "Pause" : "Resume"}
          </button>
        </form>
        <ConfirmForm action={deleteRecurringItem} message={`Delete "${item.name}" from the template forever?`}>
          <input type="hidden" name="id" value={item.id} />
          <button className="rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-red-50 hover:text-red-600">Delete</button>
        </ConfirmForm>
      </div>
    </div>
  );
}

function AddItem({ householdId, categories, members }: { householdId: number; categories: CatOpt[]; members: MemberOpt[] }) {
  const [kind, setKind] = useState<"income" | "expense">("expense");
  return (
    <div className="border-t border-slate-100 p-4">
      <h3 className="mb-2 text-sm font-semibold text-slate-700">+ Add recurring item</h3>
      <form action={createRecurringItem} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="householdId" value={householdId} />
        <input type="hidden" name="kind" value={kind} />
        <div className="inline-flex overflow-hidden rounded-md border border-slate-200 text-xs font-medium">
          <button type="button" onClick={() => setKind("income")} className={`px-2.5 py-1.5 ${kind === "income" ? "bg-green-600 text-white" : "text-slate-500"}`}>Income</button>
          <button type="button" onClick={() => setKind("expense")} className={`px-2.5 py-1.5 ${kind === "expense" ? "bg-indigo-600 text-white" : "text-slate-500"}`}>Expense</button>
        </div>
        <input name="name" placeholder="Name *" required className="input w-40" />
        <input name="amount" type="number" step="0.01" placeholder="₹ *" required className="input w-24" />
        <select name="memberId" className="input w-32">
          <option value="">{kind === "income" ? "Owner…" : "Who pays…"}</option>
          {members.map((m) => <option key={m.id} value={String(m.id)}>{m.name}</option>)}
        </select>
        {kind === "expense" && (
          <select name="categoryId" required className="input w-36">
            <option value="">Category *</option>
            {categories.map((c) => <option key={c.id} value={String(c.id)}>{c.name} · {c.section}</option>)}
          </select>
        )}
        <label className="flex items-center gap-1 text-[11px] text-slate-500" title="Installment (EMI): repeats a fixed number of times then stops. Leave blank for a normal repeat.">
          EMI ×<input name="installmentsTotal" type="number" min="0" placeholder="total" className="input w-16" />
          <span>on #</span>
          <input name="installmentCurrent" type="number" min="1" placeholder="this mo" className="input w-16" />
        </label>
        <button className="btn">Add</button>
      </form>
      <p className="mt-2 text-xs text-slate-400">
        Applies from next month. This is the template — the current sheet stays frozen. <b>EMI</b>: set total
        payments + which payment is <i>this</i> month; it auto-advances (3/6, 4/6…) and stops after the last.
      </p>
    </div>
  );
}
