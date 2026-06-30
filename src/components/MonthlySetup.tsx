"use client";

import { useState } from "react";
import {
  saveRecurring,
  toggleHold,
  deleteCategory,
  createCategory,
} from "@/app/actions";
import { formatINR } from "@/lib/format";

type Row = {
  id: number;
  name: string;
  monthlyBudget: number | null;
  sinking: boolean;
  cycleMonths: number | null;
  onHold: boolean;
  responsibleMemberId: number | null;
};

type MemberLite = { id: number; name: string };

export function MonthlySetup({
  rows,
  householdId,
  members,
}: {
  rows: Row[];
  householdId: number;
  members: MemberLite[];
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
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <SetupRow key={r.id} r={r} members={members} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-400">
        <b>Responsible</b> = the person this category&apos;s expenses are tagged to by default (drives
        settlement) and who is charged any over-budget excess at wind-down.
      </p>

      <AddCategory householdId={householdId} />
    </div>
  );
}

function SetupRow({ r, members }: { r: Row; members: MemberLite[] }) {
  const [amount, setAmount] = useState(r.monthlyBudget?.toString() ?? "");
  const [sinking, setSinking] = useState(r.sinking);
  const [cycle, setCycle] = useState(r.cycleMonths?.toString() ?? "");
  const [resp, setResp] = useState(r.responsibleMemberId?.toString() ?? "");

  const dirty =
    amount !== (r.monthlyBudget?.toString() ?? "") ||
    sinking !== r.sinking ||
    cycle !== (r.cycleMonths?.toString() ?? "") ||
    resp !== (r.responsibleMemberId?.toString() ?? "");
  const lump = sinking && amount && cycle ? Number(amount) * Number(cycle) : null;

  return (
    <tr className={`border-b border-slate-100 align-middle ${r.onHold ? "opacity-50" : ""}`}>
      <td className="px-4 py-2 font-medium text-slate-800">
        {r.name}
        {r.onHold && (
          <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] text-slate-600">
            on hold
          </span>
        )}
      </td>
      <td className="px-4 py-2">
        <form action={saveRecurring} id={`sf-${r.id}`} />
        <input form={`sf-${r.id}`} type="hidden" name="categoryId" value={r.id} />
        <div className="flex items-center gap-1">
          <span className="text-slate-400">₹</span>
          <input
            form={`sf-${r.id}`}
            name="monthlyBudget"
            type="number"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="none"
            className="input w-24"
          />
        </div>
      </td>
      <td className="px-4 py-2">
        <input
          form={`sf-${r.id}`}
          type="checkbox"
          name="sinking"
          checked={sinking}
          onChange={(e) => setSinking(e.target.checked)}
          className="h-4 w-4 accent-indigo-600"
        />
      </td>
      <td className="px-4 py-2">
        {sinking ? (
          <div>
            <input
              form={`sf-${r.id}`}
              name="cycleMonths"
              type="number"
              min="1"
              value={cycle}
              onChange={(e) => setCycle(e.target.value)}
              placeholder="e.g. 3"
              className="input w-16"
            />
            {lump && (
              <div className="mt-0.5 text-[11px] text-slate-400">≈ {formatINR(lump)}</div>
            )}
          </div>
        ) : (
          <span className="text-slate-300">—</span>
        )}
      </td>
      <td className="px-4 py-2">
        <select
          form={`sf-${r.id}`}
          name="responsibleMemberId"
          value={resp}
          onChange={(e) => setResp(e.target.value)}
          className="input w-28"
        >
          <option value="">Shared</option>
          {members.map((mm) => (
            <option key={mm.id} value={mm.id}>
              {mm.name}
            </option>
          ))}
        </select>
      </td>
      <td className="px-4 py-2">
        <div className="flex items-center justify-end gap-1">
          <button
            form={`sf-${r.id}`}
            disabled={!dirty}
            className="btn px-2 py-1.5 text-xs disabled:opacity-40"
          >
            Save
          </button>
          <form action={toggleHold}>
            <input type="hidden" name="categoryId" value={r.id} />
            <button className="rounded-md px-2 py-1.5 text-xs text-slate-500 hover:bg-slate-100">
              {r.onHold ? "Resume" : "Hold"}
            </button>
          </form>
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
      </td>
    </tr>
  );
}

function AddCategory({ householdId }: { householdId: number }) {
  const [name, setName] = useState("");
  const [sinking, setSinking] = useState(false);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-700">Add a category</h2>
      <form
        action={createCategory}
        onSubmit={() => {
          setName("");
          setSinking(false);
        }}
        className="grid grid-cols-2 gap-3 sm:grid-cols-5"
      >
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
        <button disabled={!name.trim()} className="btn disabled:opacity-40">
          Add
        </button>
      </form>
    </div>
  );
}
