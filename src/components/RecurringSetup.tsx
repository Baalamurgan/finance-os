"use client";

import { useEffect, useState, useActionState } from "react";
import { formatINR } from "@/lib/format";
import { scheduleSummary } from "@/lib/schedule";
import { useToast } from "@/components/Toast";
import { ConfirmForm } from "@/components/ConfirmForm";
import { createRecurringItem, saveAllRecurringItems, deleteRecurringItem, toggleRecurringActive, type SaveRecurringState } from "@/app/actions";

export type RItem = {
  id: number; kind: "income" | "expense"; name: string; amount: number;
  categoryId: number | null; section: string; memberId: number | null; memberName: string | null; active: boolean;
  installmentsTotal: number | null; installmentCurrent: number | null;
  intervalMonths: number; installmentStartYear: number | null; installmentStartMonth: number | null; dueDay: number | null;
};

// ── Schedule editor (every month | installment N times) ─────────────────────────
// Periodic "every N months" bills live on the Category now (Budgets & sinking funds →
// "Full bill"), so recurring items are just monthly lines or fixed-term installments.
type SchedKind = "monthly" | "installment";
type SchedState = { kind: SchedKind; total: string; current: string; dueDay: string };

function initSched(item?: RItem): SchedState {
  const kind: SchedKind = item && item.installmentsTotal != null && item.intervalMonths <= 1 ? "installment" : "monthly";
  return {
    kind,
    total: item && item.intervalMonths <= 1 && item.installmentsTotal != null ? String(item.installmentsTotal) : "",
    current: item?.installmentCurrent != null ? String(item.installmentCurrent) : "",
    dueDay: item?.dueDay != null ? String(item.dueDay) : "",
  };
}
const schedKey = (s: SchedState) => [s.kind, s.total, s.current, s.dueDay].join("|");

// ── Row draft: the editable state of one template row, lifted to the parent so a single
// floating "N unsaved changes → Save" bar can batch-save them all (like Budgets & sinking funds). ──
type Draft = { name: string; amount: string; memberId: string; categoryId: string; sched: SchedState };
const toDraft = (i: RItem): Draft => ({
  name: i.name,
  amount: String(i.amount),
  memberId: i.memberId != null ? String(i.memberId) : "",
  categoryId: i.categoryId != null ? String(i.categoryId) : "",
  sched: initSched(i),
});
const draftKey = (d: Draft) => [d.name, d.amount, d.memberId, d.categoryId, schedKey(d.sched)].join("|");
const draftDirty = (i: RItem, d: Draft) => draftKey(d) !== draftKey(toDraft(i));
const draftInvalid = (d: Draft) => !d.name.trim() || !d.amount || Number(d.amount) <= 0;
const draftPayload = (id: number, d: Draft) => ({
  id: String(id), name: d.name, amount: d.amount, memberId: d.memberId, categoryId: d.categoryId,
  scheduleKind: d.sched.kind, dueDay: d.sched.dueDay,
  installmentsTotal: d.sched.kind === "installment" ? d.sched.total : "",
  installmentCurrent: d.sched.kind === "installment" ? (d.sched.current || "1") : "",
});

function ScheduleEditor({ s, set, kind }: { s: SchedState; set: (s: SchedState) => void; kind: "income" | "expense" }) {
  return (
    <span className="flex flex-wrap items-center gap-1 text-[11px] text-slate-600">
      <select value={s.kind} onChange={(e) => set({ ...s, kind: e.target.value as SchedKind })} className="input py-1 text-xs" title="How often this repeats">
        <option value="monthly">every month</option>
        <option value="installment">installment (N times)</option>
      </select>
      {s.kind === "installment" && (
        <span className="flex items-center gap-1 text-indigo-600">
          ×<input type="number" min="1" value={s.total} onChange={(e) => set({ ...s, total: e.target.value })} placeholder="total" className="input w-14 py-1 text-xs" title="total payments" />
          on #<input type="number" min="1" value={s.current} onChange={(e) => set({ ...s, current: e.target.value })} placeholder="this mo" className="input w-14 py-1 text-xs" title="which payment is THIS month" />
        </span>
      )}
      <span className="flex items-center gap-1 text-slate-500" title={kind === "income" ? "Day of the month this income arrives" : "Day of the month this is due"}>
        {kind === "income" ? "arrives" : "due"} day
        <input type="number" min="1" max="31" value={s.dueDay} onChange={(e) => set({ ...s, dueDay: e.target.value })} placeholder="–" className="input w-12 py-1 text-xs" />
      </span>
    </span>
  );
}

// hidden named inputs carrying the schedule into the ADD form action
function SchedHidden({ s }: { s: SchedState }) {
  return (
    <>
      <input type="hidden" name="scheduleKind" value={s.kind} />
      <input type="hidden" name="dueDay" value={s.dueDay} />
      {s.kind === "installment" && (
        <>
          <input type="hidden" name="installmentsTotal" value={s.total} />
          <input type="hidden" name="installmentCurrent" value={s.current || "1"} />
        </>
      )}
    </>
  );
}
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
  const toast = useToast();

  // Editable drafts keyed by item id; reset whenever the server sends fresh items (load & after save).
  const [drafts, setDrafts] = useState<Record<number, Draft>>(() => Object.fromEntries(items.map((i) => [i.id, toDraft(i)])));
  useEffect(() => {
    setDrafts(Object.fromEntries(items.map((i) => [i.id, toDraft(i)])));
  }, [items]);
  const patch = (id: number, p: Partial<Draft>) => setDrafts((d) => ({ ...d, [id]: { ...d[id], ...p } }));

  const dirty = items.filter((i) => drafts[i.id] && draftDirty(i, drafts[i.id]));
  const invalidCount = dirty.filter((i) => draftInvalid(drafts[i.id])).length;
  const payload = JSON.stringify(dirty.map((i) => draftPayload(i.id, drafts[i.id])));

  const [state, formAction, pending] = useActionState<SaveRecurringState, FormData>(saveAllRecurringItems, { ok: false, n: 0 });
  useEffect(() => {
    if (state.n === 0) return;
    toast(state.ok ? "Template saved" : state.error ?? "Couldn't save", state.ok ? "success" : "error");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.n]);

  const income = items.filter((i) => i.kind === "income");
  const expenses = items.filter((i) => i.kind === "expense");
  const memberNames = Array.from(new Set(items.map((i) => i.memberName))).sort((a, b) => (a ?? "~").localeCompare(b ?? "~"));

  const row = (i: RItem) => (
    <ItemRow key={i.id} item={i} members={members} categories={categories} readOnly={readOnly} draft={drafts[i.id] ?? toDraft(i)} patch={patch} />
  );

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">🔁 Recurring template</h2>
          <p className="text-xs text-slate-500">The source of truth — every month is generated from these. Edits apply from next month.</p>
          <p className="mt-0.5 text-[11px] text-slate-400">Budgeted &amp; sinking categories (Petrol, EB, insurance…) are managed in <b>Budgets &amp; sinking funds</b> below.</p>
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
                {rows.map(row)}
              </Group>
            );
          })
        ) : (
          <>
            <Group title="Income" note={formatINR(income.reduce((s, i) => s + i.amount, 0))}>
              {income.length === 0 ? <Empty /> : income.map(row)}
            </Group>
            {SECTIONS.map((sec) => {
              const rows = expenses.filter((e) => e.section === sec);
              if (rows.length === 0) return null;
              return (
                <Group key={sec} title={SECTION_LABEL[sec]} note={formatINR(rows.reduce((s, e) => s + e.amount, 0))}>
                  {rows.map(row)}
                </Group>
              );
            })}
          </>
        )}
      </div>

      {!readOnly && <AddItem householdId={householdId} categories={categories} members={members} />}

      {/* single always-visible Save bar — appears only when a row changed. Stacked above the
          Budgets & sinking funds bar so both can coexist. */}
      {!readOnly && dirty.length > 0 && (
        <div className="fixed inset-x-0 bottom-32 z-40 flex justify-center px-4 sm:bottom-20">
          <form action={formAction} className="flex items-center gap-3 rounded-full border border-slate-200 bg-white/95 px-4 py-2 shadow-lg backdrop-blur">
            <input type="hidden" name="rows" value={payload} />
            <span className="text-sm text-slate-600">
              🔁 {dirty.length} unsaved change{dirty.length > 1 ? "s" : ""}
              {invalidCount > 0 && <span className="ml-1 text-red-600">· {invalidCount} need fixing</span>}
            </span>
            <button
              type="submit"
              disabled={invalidCount > 0 || pending}
              className="rounded-full bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
            >
              {pending ? "Saving…" : "Save changes"}
            </button>
          </form>
        </div>
      )}
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

function ItemRow({ item, members, categories, readOnly, draft, patch }: { item: RItem; members: MemberOpt[]; categories: CatOpt[]; readOnly: boolean; draft: Draft; patch: (id: number, p: Partial<Draft>) => void }) {
  const dirty = draftDirty(item, draft);
  const invalid = draftInvalid(draft);

  if (readOnly) {
    return (
      <div className="flex items-center justify-between gap-2 py-2 pl-2 text-sm">
        <span className="truncate text-slate-700">
          {item.name}
          {item.installmentsTotal != null && item.installmentCurrent != null && item.intervalMonths <= 1 && <span className="ml-1.5 text-[11px] text-indigo-500">{item.installmentCurrent}/{item.installmentsTotal}</span>}
          {scheduleSummary(item) && <span className="ml-1.5 text-[11px] text-violet-600">· {scheduleSummary(item)}</span>}
          {item.memberName ? <span className="ml-1.5 text-[11px] text-slate-400">· {item.memberName}</span> : null}
        </span>
        <span className="tabular-nums text-slate-700">{formatINR(item.amount)}</span>
      </div>
    );
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 py-2 pl-2 pr-1 text-sm ${item.active ? "" : "opacity-50"} ${invalid && dirty ? "bg-red-50/40" : dirty ? "bg-amber-50/40" : ""}`}>
      <input value={draft.name} onChange={(e) => patch(item.id, { name: e.target.value })} className="input w-40 py-1 text-sm" />
      {item.installmentsTotal != null && item.installmentCurrent != null && item.intervalMonths <= 1 && (
        <span className="rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-500" title="installment (this month / total)">
          {item.installmentCurrent}/{item.installmentsTotal}
        </span>
      )}
      <div className="flex items-center gap-1">
        <span className="text-slate-400">₹</span>
        <input type="number" step="0.01" value={draft.amount} onChange={(e) => patch(item.id, { amount: e.target.value })} className="input w-24 py-1 text-sm" />
      </div>
      <select value={draft.memberId} onChange={(e) => patch(item.id, { memberId: e.target.value })} className="input w-28 py-1 text-xs" title={item.kind === "income" ? "owner" : "who pays"}>
        <option value="">{item.kind === "income" ? "Owner…" : "Shared"}</option>
        {members.map((m) => <option key={m.id} value={String(m.id)}>{m.name}</option>)}
      </select>
      {item.kind === "expense" && (
        <select value={draft.categoryId} onChange={(e) => patch(item.id, { categoryId: e.target.value })} className="input w-32 py-1 text-xs" title="category">
          {categories.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
        </select>
      )}
      <ScheduleEditor s={draft.sched} set={(sched) => patch(item.id, { sched })} kind={item.kind === "income" ? "income" : "expense"} />
      <div className="ml-auto flex items-center gap-1">
        {dirty && <span className="text-[10px] font-medium text-amber-600">edited</span>}
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
  const [sched, setSched] = useState<SchedState>(() => initSched());
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
        <ScheduleEditor s={sched} set={setSched} kind={kind} />
        <SchedHidden s={sched} />
        <button className="btn">Add</button>
      </form>
      <p className="mt-2 text-xs text-slate-400">
        Applies from next month. This is the template — the current sheet stays frozen.{" "}
        {sched.kind === "installment" && <><b>Installment</b>: total payments + which is <i>this</i> month; auto-advances (3/6…) then stops.</>}
        {" "}Periodic bills (yearly insurance, every-2-months EMI) are set up in <b>Budgets &amp; sinking funds</b>.
      </p>
    </div>
  );
}
