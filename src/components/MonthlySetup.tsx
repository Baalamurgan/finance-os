"use client";

import { useActionState, useEffect, useState } from "react";
import {
  saveRecurring,
  toggleHold,
  deleteCategory,
  createCategory,
} from "@/app/actions";
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
// Billing cycle: 1 = a plain monthly expense; the rest are periodic bills.
const CYCLES: { v: string; label: string }[] = [
  { v: "1", label: "Monthly" },
  { v: "2", label: "Every 2 months" },
  { v: "3", label: "Quarterly" },
  { v: "6", label: "Half-yearly" },
  { v: "12", label: "Yearly" },
];
// Save cadence for auto-funded bills — only those dividing the billing cycle are offered.
const CADENCES: { v: number; label: string }[] = [
  { v: 1, label: "monthly" },
  { v: 2, label: "every 2 mo" },
  { v: 3, label: "quarterly" },
  { v: 6, label: "every 6 mo" },
];
const cadencesFor = (cycle: number) => CADENCES.filter((c) => c.v <= cycle && cycle % c.v === 0);
const round2 = (x: number) => Math.round(x * 100) / 100;

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
              <th className="px-4 py-2"></th>
              {/* frozen so the On/Off switch stays visible while the table scrolls */}
              <th className="sticky right-0 bg-slate-50 px-4 py-2 shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.12)]">On / off</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <SetupRow key={r.id} r={r} members={members} readOnly={readOnly} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-400">
        Pick a <b>billing cycle</b>. <b>Monthly</b> is a normal monthly expense — tick <b>Track &amp; save
        leftover → Piggy</b> for variable ones (Petrol, Provision), leave it off for a flat fixed bill.
        Any longer cycle is a <b>periodic bill</b>: enter the full bill, its due month, then <b>save the share</b>
        (set aside a bit each cadence, drawn at the due month) or <b>pay in full</b>. Switching the cycle keeps
        the true annual cost. <b>Changes apply from next month.</b>
      </p>

      {!readOnly && <AddCategory householdId={householdId} members={members} />}
    </div>
  );
}

function SetupRow({ r, members, readOnly }: { r: Row; members: MemberLite[]; readOnly: boolean }) {
  const toast = useToast();
  const [name, setName] = useState(r.name);
  const [section, setSection] = useState(r.section);
  // cycle: "1" = monthly; the category is periodic iff billEveryMonths was set
  const initCycle = r.billEveryMonths != null ? String(r.billEveryMonths) : "1";
  const [cycle, setCycle] = useState(initCycle);
  const periodic = Number(cycle) > 1;
  // one amount box: the monthly amount (monthly) OR the full per-occurrence bill (periodic)
  const initAmount = ((r.billEveryMonths != null ? r.billAmount : r.monthlyBudget) ?? "").toString();
  const [amount, setAmount] = useState(initAmount);
  const [fixed, setFixed] = useState(r.fixed);
  const [fundingStyle, setFundingStyle] = useState(r.fundingStyle === "none" ? "none" : "auto");
  const [saveEvery, setSaveEvery] = useState(r.saveEveryMonths != null ? String(r.saveEveryMonths) : "1");
  const [billMonth, setBillMonth] = useState(String(r.billMonth ?? new Date().getMonth() + 1));
  const [billDay, setBillDay] = useState(r.billDay != null ? String(r.billDay) : "");
  const [resp, setResp] = useState(r.responsibleMemberId != null ? String(r.responsibleMemberId) : "");

  const [state, formAction, pending] = useActionState(saveRecurring, { ok: false, n: 0 });
  useEffect(() => {
    if (state.n === 0) return;
    toast(state.ok ? `Saved "${name}"` : state.error ?? "Couldn't save", state.ok ? "success" : "error");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.n]);

  // switching cycle converts the amount so the true annual cost stays constant
  const changeCycle = (next: string) => {
    const from = Math.max(1, Number(cycle) || 1);
    const to = Math.max(1, Number(next) || 1);
    const a = Number(amount);
    if (a > 0 && from !== to) setAmount(String(round2((a * to) / from)));
    setCycle(next);
    if (Number(next) > 1 && !cadencesFor(Number(next)).some((c) => c.v === Number(saveEvery))) setSaveEvery("1");
  };

  const baseResp = r.responsibleMemberId != null ? String(r.responsibleMemberId) : "";
  const dirty =
    name.trim() !== r.name || section !== r.section || cycle !== initCycle ||
    amount !== initAmount || fixed !== r.fixed ||
    fundingStyle !== (r.fundingStyle === "none" ? "none" : "auto") ||
    saveEvery !== (r.saveEveryMonths != null ? String(r.saveEveryMonths) : "1") ||
    billMonth !== String(r.billMonth ?? new Date().getMonth() + 1) ||
    billDay !== (r.billDay != null ? String(r.billDay) : "") || resp !== baseResp;
  const invalid =
    !name.trim() ||
    (periodic && (!amount || Number(amount) <= 0)) ||
    (!periodic && fixed && (!amount || Number(amount) <= 0));
  const shareHint = periodic && fundingStyle === "auto" && amount && Number(amount) > 0
    ? round2((Number(amount) * Number(saveEvery)) / Number(cycle))
    : null;
  const respMissing = resp !== "" && !members.some((m) => String(m.id) === resp);

  return (
    <tr className={`border-b border-slate-100 align-middle ${r.onHold ? "opacity-50" : ""}`}>
      <td className="px-4 py-2">
        {/* The real <form> carries every value as a hidden input, so submission is reliable
            regardless of table layout. billEveryMonths blank = monthly (cycle 1). */}
        <form action={formAction} id={`sf-${r.id}`}>
          <input type="hidden" name="categoryId" value={r.id} />
          <input type="hidden" name="name" value={name} />
          <input type="hidden" name="section" value={section} />
          <input type="hidden" name="billEveryMonths" value={periodic ? cycle : ""} />
          <input type="hidden" name="monthlyBudget" value={periodic ? "" : amount} />
          <input type="hidden" name="fixed" value={!periodic && fixed ? "on" : ""} />
          <input type="hidden" name="billAmount" value={periodic ? amount : ""} />
          <input type="hidden" name="billMonth" value={periodic ? billMonth : ""} />
          <input type="hidden" name="billDay" value={periodic ? billDay : ""} />
          <input type="hidden" name="fundingStyle" value={periodic ? fundingStyle : ""} />
          <input type="hidden" name="saveEveryMonths" value={periodic && fundingStyle === "auto" ? saveEvery : ""} />
          <input type="hidden" name="responsibleMemberId" value={resp} />
        </form>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={readOnly}
          className="input w-36 font-medium text-slate-800 disabled:bg-slate-100 disabled:text-slate-500"
        />
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <select
            value={section}
            onChange={(e) => setSection(e.target.value)}
            disabled={readOnly}
            className="input w-28 py-1 text-xs disabled:bg-slate-100 disabled:text-slate-400"
          >
            {SECTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          {r.onHold && (
            <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-medium text-slate-600">Hold</span>
          )}
          {r.needsReview && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700" title="Migrated from a rolling sinking fund — check the due month & amount, then Save.">
              review due month
            </span>
          )}
        </div>
      </td>
      {/* Billing cycle */}
      <td className="px-4 py-2">
        <select
          value={cycle}
          onChange={(e) => changeCycle(e.target.value)}
          disabled={readOnly}
          className="input w-32 py-1 text-xs disabled:bg-slate-100 disabled:text-slate-400"
          title="How often this bill is charged"
        >
          {CYCLES.map((c) => (
            <option key={c.v} value={c.v}>{c.label}</option>
          ))}
        </select>
      </td>
      {/* Schedule: monthly behaviour, or the periodic due-month + funding */}
      <td className="px-4 py-2">
        {!periodic ? (
          <label
            className="flex items-center gap-1.5 text-[11px] text-slate-600"
            title="On = track spending vs this amount and roll the leftover into Piggy (Petrol-style). Off = a flat fixed bill paid every month (subscription-style)."
          >
            <input
              type="checkbox"
              checked={!fixed}
              onChange={(e) => setFixed(!e.target.checked)}
              disabled={readOnly}
              className="h-3.5 w-3.5 accent-indigo-600"
            />
            Track &amp; save leftover → Piggy
          </label>
        ) : (
          <div className="flex flex-col gap-1 text-xs text-slate-600">
            <div className="flex flex-wrap items-center gap-1">
              due
              <select value={billMonth} onChange={(e) => setBillMonth(e.target.value)} disabled={readOnly} className="input py-1 text-xs disabled:bg-slate-100" title="the month the bill is due">
                {MONTHS.map((m, i) => <option key={m} value={String(i + 1)}>{m}</option>)}
              </select>
              <input type="number" min="1" max="31" value={billDay} onChange={(e) => setBillDay(e.target.value)} placeholder="day" disabled={readOnly} className="input w-12 py-1 text-xs disabled:bg-slate-100" title="day (optional)" />
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <select value={fundingStyle} onChange={(e) => setFundingStyle(e.target.value)} disabled={readOnly} className="input py-1 text-xs disabled:bg-slate-100" title="how the bill is funded">
                <option value="auto">save the share</option>
                <option value="none">pay in full</option>
              </select>
              {fundingStyle === "auto" && (
                <select value={saveEvery} onChange={(e) => setSaveEvery(e.target.value)} disabled={readOnly} className="input py-1 text-xs disabled:bg-slate-100" title="how often to set aside the share">
                  {cadencesFor(Number(cycle)).map((c) => <option key={c.v} value={String(c.v)}>{c.label}</option>)}
                </select>
              )}
            </div>
            {shareHint != null && <div className="text-[10px] text-slate-400">≈ {formatINR(shareHint)} set aside each time</div>}
          </div>
        )}
        {invalid && dirty && <div className="mt-0.5 text-[11px] font-medium text-red-600">check amount / schedule</div>}
      </td>
      {/* Amount (converts on cycle switch) */}
      <td className="px-4 py-2">
        <div className="flex items-center gap-1">
          <span className="text-slate-400">₹</span>
          <input
            type="number"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={periodic ? "full bill" : "none"}
            disabled={readOnly}
            className="input w-24 disabled:bg-slate-100 disabled:text-slate-400"
          />
        </div>
        {periodic && <div className="mt-0.5 text-[10px] text-slate-400">full bill / {CYCLES.find((c) => c.v === cycle)?.label.toLowerCase()}</div>}
      </td>
      <td className="px-4 py-2">
        <select
          value={resp}
          onChange={(e) => setResp(e.target.value)}
          disabled={readOnly}
          className="input w-28 disabled:bg-slate-100 disabled:text-slate-400"
        >
          <option value="">Shared</option>
          {members.map((mm) => (
            <option key={mm.id} value={String(mm.id)}>{mm.name}</option>
          ))}
          {respMissing && <option value={resp}>Member #{resp}</option>}
        </select>
        {periodic && (
          <div className="mt-0.5 text-[10px] font-medium text-slate-500">
            {resp ? "paid by (settlement credit)" : "pick who pays it"}
          </div>
        )}
      </td>
      <td className="px-4 py-2">
        {readOnly ? (
          <span className="block text-right text-xs text-slate-300">—</span>
        ) : (
          <div className="flex items-center justify-end gap-1">
            <button
              form={`sf-${r.id}`}
              type="submit"
              disabled={!dirty || invalid || pending}
              className="btn px-2 py-1.5 text-xs disabled:opacity-40"
            >
              {pending ? "Saving…" : "Save"}
            </button>
            <form
              action={deleteCategory}
              onSubmit={(e) => {
                if (!confirm(`Delete ${r.name}? (only works if it has no sheet history)`))
                  e.preventDefault();
              }}
            >
              <input type="hidden" name="categoryId" value={r.id} />
              <button className="rounded-md px-2 py-1.5 text-xs text-slate-400 hover:bg-red-50 hover:text-red-600">
                Delete
              </button>
            </form>
          </div>
        )}
      </td>
      {/* ON = counts toward next month's sheet + Expenses tab; OFF (held) = skipped. Frozen column. */}
      <td className={`sticky right-0 px-4 py-2 shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.12)] ${r.onHold ? "bg-slate-50" : "bg-white"}`}>
        {readOnly ? (
          <span className="text-xs text-slate-300">{r.onHold ? "off" : "on"}</span>
        ) : (
          <form action={toggleHold}>
            <input type="hidden" name="categoryId" value={r.id} />
            <button
              type="submit"
              aria-pressed={!r.onHold}
              title={r.onHold ? "Off — skipped from next month" : "On — counts from next month"}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                r.onHold ? "bg-slate-300" : "bg-indigo-600"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  r.onHold ? "translate-x-0.5" : "translate-x-4"
                }`}
              />
            </button>
          </form>
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
  const [state, formAction, pending] = useActionState(createCategory, { ok: false, n: 0 });

  useEffect(() => {
    if (state.n === 0) return;
    if (state.ok) {
      setName(""); setCycle("1"); setFixed(false); setAmount(""); setFundingStyle("auto"); setSaveEvery("1"); setBillDay(""); setPaidBy("");
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
    if (Number(next) > 1 && !cadencesFor(Number(next)).some((c) => c.v === Number(saveEvery))) setSaveEvery("1");
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

        <input name="name" placeholder="Name *" value={name} onChange={(e) => setName(e.target.value)} required className="input w-36" />
        <select value={cycle} onChange={(e) => changeCycle(e.target.value)} className="input w-32 text-xs" title="Billing cycle">
          {CYCLES.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
        </select>
        <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={periodic ? "₹ full bill" : "₹ / month"} className="input w-28" />
        <select value={section} onChange={(e) => setSection(e.target.value)} className="input w-24 text-xs">
          {SECTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={paidBy} onChange={(e) => setPaidBy(e.target.value)} className="input w-28 text-xs">
          <option value="">Paid by…</option>
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
          </span>
        )}
        <button disabled={!name.trim() || pending} className="btn disabled:opacity-40">{pending ? "Adding…" : "Add"}</button>
      </form>
      <p className="mt-2 text-xs text-slate-400">
        Applies from <b>next month</b>. A <b>periodic bill</b> (yearly insurance, 2-monthly EMI): set the full
        amount + due month, then <i>save the share</i> (set aside on the chosen cadence, drawn at the due month)
        or <i>pay in full</i> (the whole bill lands only on its month). Switching the cycle re-computes the amount.
      </p>
    </div>
  );
}
