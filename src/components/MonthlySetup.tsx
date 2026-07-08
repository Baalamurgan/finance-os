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
};

type MemberLite = { id: number; name: string };

const SECTIONS = ["Loans", "Chits", "Monthly", "Yearly", "Misc"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FREQS: { v: string; label: string }[] = [
  { v: "2", label: "every 2 months" }, { v: "3", label: "quarterly" },
  { v: "6", label: "half-yearly" }, { v: "12", label: "yearly" },
];
type BillMode = "monthly" | "sinking" | "lump";

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
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-slate-500">
              <th className="px-4 py-2">Category</th>
              <th className="px-4 py-2">Amount (₹)</th>
              <th className="px-4 py-2">Billing</th>
              <th className="px-4 py-2">Schedule</th>
              <th className="px-4 py-2">Responsible</th>
              <th className="px-4 py-2">Counts next mo.</th>
              <th className="px-4 py-2"></th>
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
        Every item is a monthly expense tagged to whoever pays it (so settlement subtracts it from
        their salary). Tick <b>Track &amp; save leftover → Piggy</b> for variable ones (Petrol,
        Provision) where you want the leftover saved; leave it off for flat fixed bills (subscriptions,
        EMIs). <b>Changes apply from next month</b> — the current sheet isn&apos;t touched.
      </p>

      {!readOnly && <AddCategory householdId={householdId} members={members} />}
    </div>
  );
}

function SetupRow({ r, members, readOnly }: { r: Row; members: MemberLite[]; readOnly: boolean }) {
  const toast = useToast();
  const [name, setName] = useState(r.name);
  const [section, setSection] = useState(r.section);
  const initMode: BillMode = r.billEveryMonths != null ? "lump" : r.sinking ? "sinking" : "monthly";
  const [mode, setMode] = useState<BillMode>(initMode);
  // one amount box: monthly/sinking share OR the full bill (lump), routed by mode on submit
  const [amount, setAmount] = useState(((r.billEveryMonths != null ? r.billAmount : r.monthlyBudget) ?? "").toString());
  const [cycle, setCycle] = useState(r.cycleMonths?.toString() ?? "");
  const [fixed, setFixed] = useState(r.fixed);
  const [every, setEvery] = useState(r.billEveryMonths != null ? String(r.billEveryMonths) : "12");
  const [billMonth, setBillMonth] = useState(String(r.billMonth ?? new Date().getMonth() + 1));
  const [billDay, setBillDay] = useState(r.billDay != null ? String(r.billDay) : "");
  const [resp, setResp] = useState(r.responsibleMemberId != null ? String(r.responsibleMemberId) : "");

  const [state, formAction, pending] = useActionState(saveRecurring, { ok: false, n: 0 });
  useEffect(() => {
    if (state.n === 0) return;
    toast(state.ok ? `Saved "${name}"` : state.error ?? "Couldn't save", state.ok ? "success" : "error");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.n]);

  const baseResp = r.responsibleMemberId != null ? String(r.responsibleMemberId) : "";
  const baseAmount = ((r.billEveryMonths != null ? r.billAmount : r.monthlyBudget) ?? "").toString();
  const dirty =
    name.trim() !== r.name || section !== r.section || mode !== initMode ||
    amount !== baseAmount || cycle !== (r.cycleMonths?.toString() ?? "") || fixed !== r.fixed ||
    every !== (r.billEveryMonths != null ? String(r.billEveryMonths) : "12") ||
    billMonth !== String(r.billMonth ?? new Date().getMonth() + 1) ||
    billDay !== (r.billDay != null ? String(r.billDay) : "") || resp !== baseResp;
  const lumpEquiv = mode === "sinking" && amount && cycle ? Number(amount) * Number(cycle) : null;
  const invalid =
    !name.trim() ||
    (mode === "sinking" && (!amount || Number(amount) <= 0 || !cycle || Number(cycle) < 1)) ||
    (mode === "lump" && (!amount || Number(amount) <= 0)) ||
    (mode === "monthly" && fixed && (!amount || Number(amount) <= 0));
  // if the saved responsible member isn't in the list (edge case), still show it
  const respMissing = resp !== "" && !members.some((m) => String(m.id) === resp);

  return (
    <tr className={`border-b border-slate-100 align-middle ${r.onHold ? "opacity-50" : ""}`}>
      <td className="px-4 py-2">
        {/* The real <form> carries every value as a hidden input, so submission is
            reliable regardless of table layout (fixes the responsible→Shared reset). */}
        <form action={formAction} id={`sf-${r.id}`}>
          <input type="hidden" name="categoryId" value={r.id} />
          <input type="hidden" name="name" value={name} />
          <input type="hidden" name="section" value={section} />
          <input type="hidden" name="billingMode" value={mode} />
          <input type="hidden" name="monthlyBudget" value={mode === "lump" ? "" : amount} />
          <input type="hidden" name="cycleMonths" value={mode === "sinking" ? cycle : ""} />
          <input type="hidden" name="fixed" value={mode === "monthly" && fixed ? "on" : ""} />
          <input type="hidden" name="billEveryMonths" value={mode === "lump" ? every : ""} />
          <input type="hidden" name="billMonth" value={mode === "lump" ? billMonth : ""} />
          <input type="hidden" name="billDay" value={mode === "lump" ? billDay : ""} />
          <input type="hidden" name="billAmount" value={mode === "lump" ? amount : ""} />
          <input type="hidden" name="responsibleMemberId" value={resp} />
        </form>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={readOnly}
          className="input w-36 font-medium text-slate-800 disabled:bg-slate-100 disabled:text-slate-500"
        />
        <div className="mt-1 flex items-center gap-1">
          <select
            value={section}
            onChange={(e) => setSection(e.target.value)}
            disabled={readOnly}
            className="input w-28 py-1 text-xs disabled:bg-slate-100 disabled:text-slate-400"
          >
            {SECTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          {r.onHold && (
            <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-medium text-slate-600">
              Hold
            </span>
          )}
        </div>
        {!readOnly && mode === "monthly" && (
          <label
            className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-600"
            title="On = track spending vs this amount and roll the leftover into Piggy (Petrol-style). Off = a flat fixed bill that's just paid every month (YouTube-style)."
          >
            <input
              type="checkbox"
              checked={!fixed}
              onChange={(e) => setFixed(!e.target.checked)}
              className="h-3.5 w-3.5 accent-indigo-600"
            />
            Track &amp; save leftover → Piggy
          </label>
        )}
      </td>
      <td className="px-4 py-2">
        <div className="flex items-center gap-1">
          <span className="text-slate-400">₹</span>
          <input
            type="number"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="none"
            disabled={readOnly}
            className="input w-24 disabled:bg-slate-100 disabled:text-slate-400"
          />
        </div>
      </td>
      {/* Billing mode */}
      <td className="px-4 py-2">
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as BillMode)}
          disabled={readOnly}
          className="input w-28 py-1 text-xs disabled:bg-slate-100 disabled:text-slate-400"
          title="How this bill is charged"
        >
          <option value="monthly">Monthly</option>
          <option value="sinking">Sinking fund</option>
          <option value="lump">Full bill</option>
        </select>
      </td>
      {/* mode detail: sinking cycle | lump schedule | monthly note */}
      <td className="px-4 py-2">
        {mode === "sinking" ? (
          <div>
            <div className="flex items-center gap-1 text-xs text-slate-500">
              every
              <input type="number" min="1" value={cycle} onChange={(e) => setCycle(e.target.value)} placeholder="3" disabled={readOnly} className="input w-14 disabled:bg-slate-100" />
              mo
            </div>
            {lumpEquiv ? <div className="mt-0.5 text-[11px] text-slate-400">≈ {formatINR(lumpEquiv)} per bill</div> : null}
          </div>
        ) : mode === "lump" ? (
          <div className="flex flex-wrap items-center gap-1 text-xs text-violet-700">
            <select value={every} onChange={(e) => setEvery(e.target.value)} disabled={readOnly} className="input py-1 text-xs disabled:bg-slate-100">
              {FREQS.map((f) => <option key={f.v} value={f.v}>{f.label}</option>)}
            </select>
            in
            <select value={billMonth} onChange={(e) => setBillMonth(e.target.value)} disabled={readOnly} className="input py-1 text-xs disabled:bg-slate-100" title="the month the bill is due">
              {MONTHS.map((m, i) => <option key={m} value={String(i + 1)}>{m}</option>)}
            </select>
            <input type="number" min="1" max="31" value={billDay} onChange={(e) => setBillDay(e.target.value)} placeholder="day" disabled={readOnly} className="input w-12 py-1 text-xs disabled:bg-slate-100" title="day (optional)" />
          </div>
        ) : fixed ? (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">fixed bill</span>
        ) : (
          <span className="text-slate-300">—</span>
        )}
        {invalid && dirty && <div className="mt-0.5 text-[11px] font-medium text-red-600">check amount / cycle</div>}
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
            <option key={mm.id} value={String(mm.id)}>
              {mm.name}
            </option>
          ))}
          {respMissing && <option value={resp}>Member #{resp}</option>}
        </select>
        {fixed && (
          <div className="mt-0.5 text-[10px] font-medium text-slate-500">
            {resp ? "paid by (settlement credit)" : "pick who pays it"}
          </div>
        )}
      </td>
      {/* ON = counts toward next month's sheet + shows in the Expenses tab; OFF (held) = skipped */}
      <td className="px-4 py-2">
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
    </tr>
  );
}

function AddCategory({ householdId, members }: { householdId: number; members: MemberLite[] }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [mode, setMode] = useState<BillMode>("monthly");
  const [fixed, setFixed] = useState(false);
  const [amount, setAmount] = useState("");
  const [cycle, setCycle] = useState("");
  const [every, setEvery] = useState("12");
  const [billMonth, setBillMonth] = useState(String(new Date().getMonth() + 1));
  const [billDay, setBillDay] = useState("");
  const [section, setSection] = useState("Monthly");
  const [paidBy, setPaidBy] = useState("");
  const [state, formAction, pending] = useActionState(createCategory, { ok: false, n: 0 });

  useEffect(() => {
    if (state.n === 0) return;
    if (state.ok) {
      setName(""); setMode("monthly"); setFixed(false); setAmount(""); setCycle(""); setEvery("12"); setBillDay(""); setPaidBy("");
      toast("Category added", "success");
    } else toast(state.error ?? "Couldn't add category", "error");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.n]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-700">Add a category</h2>
      <form action={formAction} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="householdId" value={householdId} />
        <input type="hidden" name="billingMode" value={mode} />
        <input type="hidden" name="section" value={section} />
        <input type="hidden" name="fixed" value={mode === "monthly" && fixed ? "on" : ""} />
        <input type="hidden" name="monthlyBudget" value={mode === "lump" ? "" : amount} />
        <input type="hidden" name="cycleMonths" value={mode === "sinking" ? cycle : ""} />
        <input type="hidden" name="billEveryMonths" value={mode === "lump" ? every : ""} />
        <input type="hidden" name="billMonth" value={mode === "lump" ? billMonth : ""} />
        <input type="hidden" name="billDay" value={mode === "lump" ? billDay : ""} />
        <input type="hidden" name="billAmount" value={mode === "lump" ? amount : ""} />

        <input name="name" placeholder="Name *" value={name} onChange={(e) => setName(e.target.value)} required className="input w-36" />
        <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={mode === "lump" ? "₹ full bill" : "₹ / month"} className="input w-28" />
        <select value={mode} onChange={(e) => setMode(e.target.value as BillMode)} className="input w-32 text-xs" title="How it's charged">
          <option value="monthly">Monthly</option>
          <option value="sinking">Sinking fund</option>
          <option value="lump">Full bill (periodic)</option>
        </select>
        <select value={section} onChange={(e) => setSection(e.target.value)} className="input w-24 text-xs">
          {SECTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={paidBy} onChange={(e) => setPaidBy(e.target.value)} className="input w-28 text-xs">
          <option value="">Paid by…</option>
          {members.map((m) => <option key={m.id} value={String(m.id)}>{m.name}</option>)}
        </select>
        <input type="hidden" name="responsibleMemberId" value={paidBy} />

        {mode === "monthly" && (
          <label className="flex items-center gap-1.5 text-xs text-slate-600" title="On = track spending & save leftover to Piggy. Off = flat fixed bill.">
            <input type="checkbox" checked={!fixed} onChange={(e) => setFixed(!e.target.checked)} className="h-4 w-4 accent-indigo-600" />
            Track &amp; save → Piggy
          </label>
        )}
        {mode === "sinking" && (
          <span className="flex items-center gap-1 text-xs text-slate-600">every <input type="number" min="1" value={cycle} onChange={(e) => setCycle(e.target.value)} placeholder="mo" className="input w-14" /> mo</span>
        )}
        {mode === "lump" && (
          <span className="flex flex-wrap items-center gap-1 text-xs text-violet-700">
            <select value={every} onChange={(e) => setEvery(e.target.value)} className="input py-1 text-xs">
              {FREQS.map((f) => <option key={f.v} value={f.v}>{f.label}</option>)}
            </select>
            in
            <select value={billMonth} onChange={(e) => setBillMonth(e.target.value)} className="input py-1 text-xs">
              {MONTHS.map((m, i) => <option key={m} value={String(i + 1)}>{m}</option>)}
            </select>
            <input type="number" min="1" max="31" value={billDay} onChange={(e) => setBillDay(e.target.value)} placeholder="day" className="input w-12 py-1 text-xs" />
          </span>
        )}
        <button disabled={!name.trim() || pending} className="btn disabled:opacity-40">{pending ? "Adding…" : "Add"}</button>
      </form>
      <p className="mt-2 text-xs text-slate-400">
        Applies from <b>next month</b>. <b>Sinking fund</b> = save the monthly share into a fund. <b>Full bill</b> =
        the whole amount lands only in its due month (yearly insurance, every-2-months EMI) — no monthly share.
      </p>
    </div>
  );
}
