"use client";

import { useActionState, useEffect, useState } from "react";
import { saveAllRecurring, toggleHold, deleteCategory, createCategory } from "@/app/actions";
import { formatINR } from "@/lib/format";
import { useToast } from "@/components/Toast";

type Row = {
  id: number;
  name: string;
  section: string;
  monthlyBudget: number | null;
  sinking: boolean;
  cycleMonths: number | null;
  onHold: boolean;
  fixed: boolean;
  responsibleMemberId: number | null;
  payerMemberId: number | null;
  billEveryMonths: number | null;
  billMonth: number | null;
  billDay: number | null;
  billAmount: number | null;
  fundingStyle: string | null;
  saveEveryMonths: number | null;
  needsReview: boolean;
};

type MemberLite = { id: number; name: string };

const SECTIONS = ["Loans", "Chits", "Monthly", "Yearly", "Misc"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const CYCLES: { v: string; label: string }[] = [
  { v: "1", label: "Monthly" },
  { v: "2", label: "Every 2 months" },
  { v: "3", label: "Quarterly" },
  { v: "6", label: "Half-yearly" },
  { v: "12", label: "Yearly" },
];
const CADENCES: { v: number; label: string }[] = [
  { v: 1, label: "monthly" },
  { v: 2, label: "every 2 mo" },
  { v: 3, label: "quarterly" },
  { v: 6, label: "every 6 mo" },
];
const cadencesFor = (cycle: number) => CADENCES.filter((c) => c.v <= cycle && cycle % c.v === 0);
const round2 = (x: number) => Math.round(x * 100) / 100;

// The editable per-row state (mirrors the Setup form fields). For a MONTHLY cycle,
// `monthlyKind` picks between a tracked budget, a flat fixed bill, or a "save the share"
// bill-with-a-fund that's paid every month via the In-Hand pay button (billEveryMonths=1).
type MonthlyKind = "track" | "fixed" | "bill";
type Draft = {
  name: string; section: string; cycle: string; amount: string; monthlyKind: MonthlyKind;
  fundingStyle: string; saveEvery: string; billMonth: string; billDay: string; resp: string; payer: string;
};
const toDraft = (r: Row): Draft => ({
  name: r.name,
  section: r.section,
  cycle: r.billEveryMonths != null ? String(r.billEveryMonths) : "1",
  amount: ((r.billEveryMonths != null ? r.billAmount : r.monthlyBudget) ?? "").toString(),
  monthlyKind: r.billEveryMonths === 1 && r.fundingStyle != null ? "bill" : r.fixed ? "fixed" : "track",
  fundingStyle: r.fundingStyle === "none" ? "none" : "auto",
  saveEvery: r.saveEveryMonths != null ? String(r.saveEveryMonths) : "1",
  billMonth: String(r.billMonth ?? new Date().getMonth() + 1),
  billDay: r.billDay != null ? String(r.billDay) : "",
  resp: r.responsibleMemberId != null ? String(r.responsibleMemberId) : "",
  payer: r.payerMemberId != null ? String(r.payerMemberId) : "",
});
const isPeriodic = (d: Draft) => Number(d.cycle) > 1;
const isMonthlyBill = (d: Draft) => !isPeriodic(d) && d.monthlyKind === "bill";
const isBill = (d: Draft) => isPeriodic(d) || isMonthlyBill(d); // bill-with-a-fund (has a pay button)
const draftInvalid = (d: Draft) =>
  !d.name.trim() ||
  (isBill(d) && (!d.amount || Number(d.amount) <= 0)) ||
  (!isPeriodic(d) && d.monthlyKind === "fixed" && (!d.amount || Number(d.amount) <= 0));
const draftDirty = (r: Row, d: Draft) => JSON.stringify(d) !== JSON.stringify(toDraft(r));
const draftPayload = (id: number, d: Draft) => {
  const periodic = isPeriodic(d);
  const monthlyBill = isMonthlyBill(d);
  const bill = periodic || monthlyBill;
  return {
    id: String(id), name: d.name, section: d.section, responsibleMemberId: d.resp, payerMemberId: bill ? d.payer : "",
    billEveryMonths: periodic ? d.cycle : monthlyBill ? "1" : "",
    monthlyBudget: bill ? "" : d.amount,
    fixed: !periodic && d.monthlyKind === "fixed" ? "on" : "",
    billAmount: bill ? d.amount : "", billMonth: bill ? d.billMonth : "", billDay: bill ? d.billDay : "",
    // monthly bill is always "save the share" (auto), saved every month
    fundingStyle: periodic ? d.fundingStyle : monthlyBill ? "auto" : "",
    saveEveryMonths: periodic ? (d.fundingStyle === "auto" ? d.saveEvery : "") : monthlyBill ? "1" : "",
  };
};

export function MonthlySetup({
  rows,
  householdId,
  members,
  readOnly = false,
}: {
  rows: Row[];
  householdId: number;
  members: MemberLite[];
  readOnly?: boolean;
}) {
  const toast = useToast();
  const [drafts, setDrafts] = useState<Record<number, Draft>>(() => Object.fromEntries(rows.map((r) => [r.id, toDraft(r)])));
  // reset drafts when the server sends new rows (initial load & after a successful save)
  useEffect(() => {
    setDrafts(Object.fromEntries(rows.map((r) => [r.id, toDraft(r)])));
  }, [rows]);
  const patch = (id: number, p: Partial<Draft>) => setDrafts((d) => ({ ...d, [id]: { ...d[id], ...p } }));

  const dirty = rows.filter((r) => drafts[r.id] && draftDirty(r, drafts[r.id]));
  const invalidCount = dirty.filter((r) => draftInvalid(drafts[r.id])).length;
  const payload = JSON.stringify(dirty.map((r) => draftPayload(r.id, drafts[r.id])));

  const [state, formAction, pending] = useActionState(saveAllRecurring, { ok: false, n: 0 });
  useEffect(() => {
    if (state.n === 0) return;
    toast(state.ok ? "Setup saved" : state.error ?? "Couldn't save", state.ok ? "success" : "error");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.n]);

  return (
    <div className="space-y-5">
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-slate-500">
              <th className="px-4 py-2">Category</th>
              <th className="px-4 py-2">Billing</th>
              <th className="px-4 py-2">Schedule</th>
              <th className="px-4 py-2">Amount (₹)</th>
              <th className="px-4 py-2">Responsible</th>
              <th className="sticky right-0 bg-slate-50 px-4 py-2 shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.12)]">On / off</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <SetupRow
                key={r.id}
                r={r}
                draft={drafts[r.id] ?? toDraft(r)}
                patch={(p) => patch(r.id, p)}
                members={members}
                readOnly={readOnly}
              />
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-400">
        Pick a <b>billing cycle</b>. <b>Monthly</b> is a normal monthly expense — tick <b>Track &amp; save
        leftover → Piggy</b> for variable ones, off for a flat fixed bill. Any longer cycle is a <b>periodic
        bill</b>: enter the full bill, its due month, who <b>saves</b> vs who <b>pays</b> it, then <b>save the
        share</b> or <b>pay in full</b>. Switching the cycle keeps the true annual cost. <b>Changes apply from
        next month.</b>
      </p>

      {!readOnly && <AddCategory householdId={householdId} members={members} />}

      {/* single always-visible Save bar — appears only when something changed */}
      {!readOnly && dirty.length > 0 && (
        <div className="fixed inset-x-0 bottom-20 z-40 flex justify-center px-4 sm:bottom-4">
          <form action={formAction} className="flex items-center gap-3 rounded-full border border-slate-200 bg-white/95 px-4 py-2 shadow-lg backdrop-blur">
            <input type="hidden" name="rows" value={payload} />
            <span className="text-sm text-slate-600">
              {dirty.length} unsaved change{dirty.length > 1 ? "s" : ""}
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
    </div>
  );
}

function SetupRow({ r, draft, patch, members, readOnly }: { r: Row; draft: Draft; patch: (p: Partial<Draft>) => void; members: MemberLite[]; readOnly: boolean }) {
  const periodic = isPeriodic(draft);
  const invalid = draftInvalid(draft);
  const dirty = draftDirty(r, draft);

  const changeCycle = (next: string) => {
    const from = Math.max(1, Number(draft.cycle) || 1);
    const to = Math.max(1, Number(next) || 1);
    const a = Number(draft.amount);
    const p: Partial<Draft> = { cycle: next };
    if (a > 0 && from !== to) p.amount = String(round2((a * to) / from));
    if (to > 1 && !cadencesFor(to).some((c) => c.v === Number(draft.saveEvery))) p.saveEvery = "1";
    patch(p);
  };

  const monthlyBill = isMonthlyBill(draft);
  const bill = periodic || monthlyBill;
  const shareHint = periodic && draft.fundingStyle === "auto" && draft.amount && Number(draft.amount) > 0
    ? round2((Number(draft.amount) * Number(draft.saveEvery)) / Number(draft.cycle))
    : null;
  const respMissing = draft.resp !== "" && !members.some((m) => String(m.id) === draft.resp);

  return (
    <tr className={`border-b border-slate-100 align-middle ${r.onHold ? "opacity-50" : ""} ${invalid && dirty ? "bg-red-50/40" : ""}`}>
      <td className="px-4 py-2">
        <input
          value={draft.name}
          onChange={(e) => patch({ name: e.target.value })}
          disabled={readOnly}
          className="input w-36 font-medium text-slate-800 disabled:bg-slate-100 disabled:text-slate-500"
        />
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <select value={draft.section} onChange={(e) => patch({ section: e.target.value })} disabled={readOnly} className="input w-28 py-1 text-xs disabled:bg-slate-100 disabled:text-slate-400">
            {SECTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {r.onHold && <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-medium text-slate-600">Hold</span>}
          {r.needsReview && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700" title="Migrated from a rolling sinking fund — check the due month & amount, then Save.">
              review due month
            </span>
          )}
        </div>
      </td>
      {/* Billing cycle */}
      <td className="px-4 py-2">
        <select value={draft.cycle} onChange={(e) => changeCycle(e.target.value)} disabled={readOnly} className="input w-32 py-1 text-xs disabled:bg-slate-100 disabled:text-slate-400" title="How often this bill is charged">
          {CYCLES.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
        </select>
      </td>
      {/* Schedule */}
      <td className="px-4 py-2">
        {!periodic ? (
          <div className="flex flex-col gap-1 text-xs text-slate-600">
            <select value={draft.monthlyKind} onChange={(e) => patch({ monthlyKind: e.target.value as MonthlyKind })} disabled={readOnly} className="input w-52 py-1 text-xs disabled:bg-slate-100" title="How this monthly item is handled">
              <option value="track">Track &amp; save leftover → Piggy</option>
              <option value="fixed">Flat fixed bill</option>
              <option value="bill">Save the share · pay in In-Hand</option>
            </select>
            {monthlyBill && (
              <div className="flex flex-wrap items-center gap-1">
                due day
                <input type="number" min="1" max="31" value={draft.billDay} onChange={(e) => patch({ billDay: e.target.value })} placeholder="day" disabled={readOnly} className="input w-12 py-1 text-xs disabled:bg-slate-100" />
                <span className="text-[10px] text-slate-400">set aside &amp; paid each month via In-Hand</span>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-1 text-xs text-slate-600">
            <div className="flex flex-wrap items-center gap-1">
              due
              <select value={draft.billMonth} onChange={(e) => patch({ billMonth: e.target.value })} disabled={readOnly} className="input py-1 text-xs disabled:bg-slate-100">
                {MONTHS.map((m, i) => <option key={m} value={String(i + 1)}>{m}</option>)}
              </select>
              <input type="number" min="1" max="31" value={draft.billDay} onChange={(e) => patch({ billDay: e.target.value })} placeholder="day" disabled={readOnly} className="input w-12 py-1 text-xs disabled:bg-slate-100" />
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <select value={draft.fundingStyle} onChange={(e) => patch({ fundingStyle: e.target.value })} disabled={readOnly} className="input py-1 text-xs disabled:bg-slate-100" title="how the bill is funded">
                <option value="auto">save the share</option>
                <option value="none">pay in full</option>
              </select>
              {draft.fundingStyle === "auto" && (
                <select value={draft.saveEvery} onChange={(e) => patch({ saveEvery: e.target.value })} disabled={readOnly} className="input py-1 text-xs disabled:bg-slate-100" title="how often to set aside">
                  {cadencesFor(Number(draft.cycle)).map((c) => <option key={c.v} value={String(c.v)}>{c.label}</option>)}
                </select>
              )}
            </div>
            {shareHint != null && <div className="text-[10px] text-slate-400">≈ {formatINR(shareHint)} set aside each time</div>}
          </div>
        )}
        {invalid && dirty && <div className="mt-0.5 text-[11px] font-medium text-red-600">check amount / schedule</div>}
      </td>
      {/* Amount */}
      <td className="px-4 py-2">
        <div className="flex items-center gap-1">
          <span className="text-slate-400">₹</span>
          <input type="number" step="0.01" value={draft.amount} onChange={(e) => patch({ amount: e.target.value })} placeholder={bill ? "full bill" : "none"} disabled={readOnly} className="input w-24 disabled:bg-slate-100 disabled:text-slate-400" />
        </div>
        {periodic && <div className="mt-0.5 text-[10px] text-slate-400">full bill / {CYCLES.find((c) => c.v === draft.cycle)?.label.toLowerCase()}</div>}
        {monthlyBill && <div className="mt-0.5 text-[10px] text-slate-400">bill / month</div>}
      </td>
      {/* Responsible (saver) + Payer for periodic bills */}
      <td className="px-4 py-2">
        <select value={draft.resp} onChange={(e) => patch({ resp: e.target.value })} disabled={readOnly} className="input w-28 disabled:bg-slate-100 disabled:text-slate-400">
          <option value="">Shared</option>
          {members.map((mm) => <option key={mm.id} value={String(mm.id)}>{mm.name}</option>)}
          {respMissing && <option value={draft.resp}>Member #{draft.resp}</option>}
        </select>
        {bill && (
          <>
            <div className="mt-0.5 text-[10px] font-medium text-slate-500">saved &amp; held by</div>
            <select value={draft.payer} onChange={(e) => patch({ payer: e.target.value })} disabled={readOnly} className="input mt-1 w-28 py-1 text-xs disabled:bg-slate-100 disabled:text-slate-400" title="who physically pays the bill">
              <option value="">paid by: same</option>
              {members.map((mm) => <option key={mm.id} value={String(mm.id)}>paid by {mm.name}</option>)}
            </select>
          </>
        )}
      </td>
      {/* frozen On/Off toggle */}
      <td className={`sticky right-0 px-4 py-2 shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.12)] ${r.onHold ? "bg-slate-50" : "bg-white"}`}>
        {readOnly ? (
          <span className="text-xs text-slate-300">{r.onHold ? "off" : "on"}</span>
        ) : (
          <div className="flex items-center gap-2">
            <form action={toggleHold}>
              <input type="hidden" name="categoryId" value={r.id} />
              <button
                type="submit"
                aria-pressed={!r.onHold}
                title={r.onHold ? "Off — skipped from next month" : "On — counts from next month"}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${r.onHold ? "bg-slate-300" : "bg-indigo-600"}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${r.onHold ? "translate-x-0.5" : "translate-x-4"}`} />
              </button>
            </form>
            <form action={deleteCategory} onSubmit={(e) => { if (!confirm(`Delete ${r.name}? (only if it has no sheet history)`)) e.preventDefault(); }}>
              <input type="hidden" name="categoryId" value={r.id} />
              <button className="rounded-md px-1.5 py-1 text-xs text-slate-300 hover:bg-red-50 hover:text-red-600" title="Delete">✕</button>
            </form>
          </div>
        )}
      </td>
    </tr>
  );
}

function AddCategory({ householdId, members }: { householdId: number; members: MemberLite[] }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [cycle, setCycle] = useState("1");
  const periodic = Number(cycle) > 1;
  const [fixed, setFixed] = useState(false);
  const [amount, setAmount] = useState("");
  const [fundingStyle, setFundingStyle] = useState("auto");
  const [saveEvery, setSaveEvery] = useState("1");
  const [billMonth, setBillMonth] = useState(String(new Date().getMonth() + 1));
  const [billDay, setBillDay] = useState("");
  const [section, setSection] = useState("Monthly");
  const [paidBy, setPaidBy] = useState("");
  const [payer, setPayer] = useState("");
  const [state, formAction, pending] = useActionState(createCategory, { ok: false, n: 0 });

  useEffect(() => {
    if (state.n === 0) return;
    if (state.ok) {
      setName(""); setCycle("1"); setFixed(false); setAmount(""); setFundingStyle("auto"); setSaveEvery("1"); setBillDay(""); setPaidBy(""); setPayer("");
      toast("Category added", "success");
    } else toast(state.error ?? "Couldn't add category", "error");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.n]);

  const changeCycle = (next: string) => {
    const from = Math.max(1, Number(cycle) || 1);
    const to = Math.max(1, Number(next) || 1);
    const a = Number(amount);
    if (a > 0 && from !== to) setAmount(String(round2((a * to) / from)));
    setCycle(next);
    if (to > 1 && !cadencesFor(to).some((c) => c.v === Number(saveEvery))) setSaveEvery("1");
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-700">Add a category</h2>
      <form action={formAction} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="householdId" value={householdId} />
        <input type="hidden" name="section" value={section} />
        <input type="hidden" name="billEveryMonths" value={periodic ? cycle : ""} />
        <input type="hidden" name="fixed" value={!periodic && fixed ? "on" : ""} />
        <input type="hidden" name="monthlyBudget" value={periodic ? "" : amount} />
        <input type="hidden" name="billAmount" value={periodic ? amount : ""} />
        <input type="hidden" name="billMonth" value={periodic ? billMonth : ""} />
        <input type="hidden" name="billDay" value={periodic ? billDay : ""} />
        <input type="hidden" name="fundingStyle" value={periodic ? fundingStyle : ""} />
        <input type="hidden" name="saveEveryMonths" value={periodic && fundingStyle === "auto" ? saveEvery : ""} />
        <input type="hidden" name="responsibleMemberId" value={paidBy} />
        <input type="hidden" name="payerMemberId" value={periodic ? payer : ""} />

        <input name="name" placeholder="Name *" value={name} onChange={(e) => setName(e.target.value)} required className="input w-36" />
        <select value={cycle} onChange={(e) => changeCycle(e.target.value)} className="input w-32 text-xs" title="Billing cycle">
          {CYCLES.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
        </select>
        <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={periodic ? "₹ full bill" : "₹ / month"} className="input w-28" />
        <select value={section} onChange={(e) => setSection(e.target.value)} className="input w-24 text-xs">
          {SECTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={paidBy} onChange={(e) => setPaidBy(e.target.value)} className="input w-28 text-xs" title={periodic ? "who saves & holds it" : "responsible member"}>
          <option value="">{periodic ? "Saved by…" : "Responsible…"}</option>
          {members.map((m) => <option key={m.id} value={String(m.id)}>{m.name}</option>)}
        </select>

        {!periodic && (
          <label className="flex items-center gap-1.5 text-xs text-slate-600" title="On = track spending & save leftover to Piggy. Off = flat fixed bill.">
            <input type="checkbox" checked={!fixed} onChange={(e) => setFixed(!e.target.checked)} className="h-4 w-4 accent-indigo-600" />
            Track &amp; save → Piggy
          </label>
        )}
        {periodic && (
          <span className="flex flex-wrap items-center gap-1 text-xs text-slate-600">
            due
            <select value={billMonth} onChange={(e) => setBillMonth(e.target.value)} className="input py-1 text-xs">
              {MONTHS.map((m, i) => <option key={m} value={String(i + 1)}>{m}</option>)}
            </select>
            <input type="number" min="1" max="31" value={billDay} onChange={(e) => setBillDay(e.target.value)} placeholder="day" className="input w-12 py-1 text-xs" />
            <select value={fundingStyle} onChange={(e) => setFundingStyle(e.target.value)} className="input py-1 text-xs" title="how the bill is funded">
              <option value="auto">save the share</option>
              <option value="none">pay in full</option>
            </select>
            {fundingStyle === "auto" && (
              <select value={saveEvery} onChange={(e) => setSaveEvery(e.target.value)} className="input py-1 text-xs" title="how often to set aside">
                {cadencesFor(Number(cycle)).map((c) => <option key={c.v} value={String(c.v)}>{c.label}</option>)}
              </select>
            )}
            <select value={payer} onChange={(e) => setPayer(e.target.value)} className="input py-1 text-xs" title="who pays it on the due month">
              <option value="">paid by: same</option>
              {members.map((m) => <option key={m.id} value={String(m.id)}>paid by {m.name}</option>)}
            </select>
          </span>
        )}
        <button disabled={!name.trim() || pending} className="btn disabled:opacity-40">{pending ? "Adding…" : "Add"}</button>
      </form>
      <p className="mt-2 text-xs text-slate-400">
        Applies from <b>next month</b>. A <b>periodic bill</b>: set the full amount + due month, who <b>saves</b>
        it (holds the share) and who <b>pays</b> it, then <i>save the share</i> or <i>pay in full</i>.
      </p>
    </div>
  );
}
