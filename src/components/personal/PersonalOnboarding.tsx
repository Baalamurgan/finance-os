"use client";

import { useActionState, useEffect, useState } from "react";
import { setPersonalPin, type PersonalPinAdminState } from "@/app/personal/lock/actions";
import { finishPersonalOnboarding } from "@/app/personal/actions";

type Cat = { id: number; name: string; icon: string | null };
const PIN_INIT: PersonalPinAdminState = { ok: false };

export function PersonalOnboarding({ categories, hasPin }: { categories: Cat[]; hasPin: boolean }) {
  const [step, setStep] = useState(hasPin ? 2 : 1);
  return (
    <div className="mx-auto max-w-md px-5 py-10">
      <div className="mb-6 text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-emerald-600 text-2xl text-white">🔒</div>
        <h1 className="mt-4 font-display text-2xl text-[#1c1c1a]">Set up Personal</h1>
        <p className="mt-1 text-sm text-slate-500">Private to you — separate from the family app.</p>
      </div>
      {step === 1 ? <PinStep onDone={() => setStep(2)} /> : <DetailsStep categories={categories} />}
      <div className="mt-6 flex justify-center gap-1.5">
        {[1, 2].map((s) => (
          <span key={s} className={`h-1.5 w-6 rounded-full ${s <= step ? "bg-emerald-600" : "bg-slate-200"}`} />
        ))}
      </div>
    </div>
  );
}

function PinStep({ onDone }: { onDone: () => void }) {
  const [state, formAction, pending] = useActionState(setPersonalPin, PIN_INIT);
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const digits = (v: string) => v.replace(/\D/g, "").slice(0, 4);
  useEffect(() => {
    if (state.ok) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok]);

  return (
    <form action={formAction} className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-slate-800">1. Choose a personal PIN</h2>
      <p className="mt-0.5 text-xs text-slate-500">A different 4-digit PIN than your family one.</p>
      <div className="mt-4 flex gap-3">
        <label className="flex-1 text-sm">
          <span className="mb-1 block text-xs text-slate-500">PIN</span>
          <input name="pin" inputMode="numeric" value={pin} onChange={(e) => setPin(digits(e.target.value))} placeholder="••••" className="input w-full text-center text-lg tracking-[0.4em]" />
        </label>
        <label className="flex-1 text-sm">
          <span className="mb-1 block text-xs text-slate-500">Confirm</span>
          <input name="confirm" inputMode="numeric" value={confirm} onChange={(e) => setConfirm(digits(e.target.value))} placeholder="••••" className="input w-full text-center text-lg tracking-[0.4em]" />
        </label>
      </div>
      {state.error && <p className="mt-2 text-xs text-red-600">{state.error}</p>}
      <button disabled={pending || pin.length !== 4 || confirm.length !== 4} className="mt-4 w-full rounded-md bg-emerald-600 px-3 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-40">
        {pending ? "Saving…" : "Continue"}
      </button>
    </form>
  );
}

function DetailsStep({ categories }: { categories: Cat[] }) {
  const [rows, setRows] = useState<{ cat: string; amt: string }[]>([{ cat: "", amt: "" }]);
  const update = (i: number, k: "cat" | "amt", v: string) =>
    setRows((r) => r.map((row, j) => (j === i ? { ...row, [k]: v } : row)));

  return (
    <form action={finishPersonalOnboarding} className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-slate-800">2. This month&apos;s income</h2>
      <div className="mt-2 flex items-center gap-2">
        <span className="text-slate-400">₹</span>
        <input name="income" type="number" step="0.01" required placeholder="0" className="input w-full text-xl font-bold" />
      </div>

      <h2 className="mt-5 text-sm font-semibold text-slate-800">3. Standard monthly expenses</h2>
      <p className="mt-0.5 text-xs text-slate-500">Rent, subscriptions… these repeat automatically every month. (Optional — add more later.)</p>
      <div className="mt-3 space-y-2">
        {rows.map((row, i) => (
          <div key={i} className="flex gap-2">
            <select
              name="recurCat"
              value={row.cat}
              onChange={(e) => update(i, "cat", e.target.value)}
              className="input flex-1"
            >
              <option value="">Category…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.icon} {c.name}
                </option>
              ))}
            </select>
            <input
              name="recurAmt"
              type="number"
              step="0.01"
              value={row.amt}
              onChange={(e) => update(i, "amt", e.target.value)}
              placeholder="₹"
              className="input w-24"
            />
          </div>
        ))}
      </div>
      <button type="button" onClick={() => setRows((r) => [...r, { cat: "", amt: "" }])} className="mt-2 text-xs font-medium text-emerald-700">
        + add another
      </button>

      <button className="mt-5 w-full rounded-md bg-emerald-600 px-3 py-2.5 text-sm font-medium text-white hover:bg-emerald-700">
        Finish setup
      </button>
    </form>
  );
}
