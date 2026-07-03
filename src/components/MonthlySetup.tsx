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
  responsibleMemberId: number | null;
};

type MemberLite = { id: number; name: string };

const SECTIONS = ["Loans", "Chits", "Monthly", "Misc"] as const;

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
              <th className="px-4 py-2">Monthly amount</th>
              <th className="px-4 py-2">Sinking?</th>
              <th className="px-4 py-2">Every (mo)</th>
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
        <b>Responsible</b> = the person this category&apos;s expenses are tagged to by default (drives
        settlement) and who is charged any over-budget excess at wind-down.
      </p>

      {!readOnly && <AddCategory householdId={householdId} />}
    </div>
  );
}

function SetupRow({ r, members, readOnly }: { r: Row; members: MemberLite[]; readOnly: boolean }) {
  const toast = useToast();
  const [name, setName] = useState(r.name);
  const [section, setSection] = useState(r.section);
  const [amount, setAmount] = useState(r.monthlyBudget?.toString() ?? "");
  const [sinking, setSinking] = useState(r.sinking);
  const [cycle, setCycle] = useState(r.cycleMonths?.toString() ?? "");
  const [resp, setResp] = useState(r.responsibleMemberId != null ? String(r.responsibleMemberId) : "");

  const [state, formAction, pending] = useActionState(saveRecurring, { ok: false, n: 0 });
  useEffect(() => {
    if (state.n === 0) return;
    toast(state.ok ? `Saved "${name}"` : state.error ?? "Couldn't save", state.ok ? "success" : "error");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.n]);

  const baseResp = r.responsibleMemberId != null ? String(r.responsibleMemberId) : "";
  const dirty =
    name.trim() !== r.name ||
    section !== r.section ||
    amount !== (r.monthlyBudget?.toString() ?? "") ||
    sinking !== r.sinking ||
    cycle !== (r.cycleMonths?.toString() ?? "") ||
    resp !== baseResp;
  const lump = sinking && amount && cycle ? Number(amount) * Number(cycle) : null;
  // sinking funds must have a monthly amount AND a cycle; name can't be blank
  const invalid =
    !name.trim() || (sinking && (!amount || Number(amount) <= 0 || !cycle || Number(cycle) < 1));
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
          <input type="hidden" name="monthlyBudget" value={amount} />
          <input type="hidden" name="sinking" value={sinking ? "on" : ""} />
          <input type="hidden" name="cycleMonths" value={cycle} />
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
            <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] text-slate-600">
              on hold
            </span>
          )}
        </div>
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
      <td className="px-4 py-2">
        <input
          type="checkbox"
          checked={sinking}
          onChange={(e) => setSinking(e.target.checked)}
          disabled={readOnly}
          className="h-4 w-4 accent-indigo-600 disabled:opacity-50"
        />
      </td>
      <td className="px-4 py-2">
        {sinking ? (
          <div>
            <input
              type="number"
              min="1"
              value={cycle}
              onChange={(e) => setCycle(e.target.value)}
              placeholder="e.g. 3"
              disabled={readOnly}
              className="input w-16 disabled:bg-slate-100 disabled:text-slate-400"
            />
            {lump && (
              <div className="mt-0.5 text-[11px] text-slate-400">≈ {formatINR(lump)} per bill</div>
            )}
            {invalid && (
              <div className="mt-0.5 text-[11px] font-medium text-red-600">amount + cycle required</div>
            )}
          </div>
        ) : (
          <span className="text-slate-300">—</span>
        )}
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

function AddCategory({ householdId }: { householdId: number }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [sinking, setSinking] = useState(false);
  const [state, formAction, pending] = useActionState(createCategory, { ok: false, n: 0 });

  useEffect(() => {
    if (state.n === 0) return;
    if (state.ok) {
      setName("");
      setSinking(false);
      toast("Category added", "success");
    } else {
      toast(state.error ?? "Couldn't add category", "error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.n]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-700">Add a category</h2>
      <form action={formAction} className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <input type="hidden" name="householdId" value={householdId} />
        <input
          name="name"
          placeholder="Name *"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="input"
        />
        <input name="monthlyBudget" type="number" step="0.01" placeholder="₹ / month" className="input" />
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            name="sinking"
            checked={sinking}
            onChange={(e) => setSinking(e.target.checked)}
            className="h-4 w-4 accent-indigo-600"
          />
          Sinking
        </label>
        <input
          name="cycleMonths"
          type="number"
          min="1"
          placeholder="every (mo)"
          disabled={!sinking}
          className="input disabled:opacity-40"
        />
        <button disabled={!name.trim() || pending} className="btn disabled:opacity-40">
          {pending ? "Adding…" : "Add"}
        </button>
      </form>
    </div>
  );
}
