"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { setHouseholdPin, disableHouseholdPin, type PinAdminState } from "@/app/lock/actions";

const INITIAL: PinAdminState = { ok: false };

export function PinSettings({ isSet, readOnly }: { isSet: boolean; readOnly: boolean }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(setHouseholdPin, INITIAL);
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");

  useEffect(() => {
    if (state.ok) {
      setPin("");
      setConfirm("");
      router.refresh();
    }
  }, [state.ok, router]);

  const onlyDigits = (v: string) => v.replace(/\D/g, "").slice(0, 4);

  if (readOnly) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">App lock</h2>
        <p className="mt-1 text-xs text-slate-500">
          {isSet
            ? "A shared PIN protects the app after Google login. The head manages it."
            : "No app-lock PIN is set. Only the head can turn it on."}
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-900">App lock (shared PIN)</h2>
      <p className="mt-0.5 text-xs text-slate-500">
        Everyone — you included — enters this 4-digit PIN after signing in with Google. It re-locks
        when the app is fully closed. This is a privacy lock on top of login, not data encryption.
      </p>

      <form action={formAction} className="mt-3 flex flex-wrap items-end gap-2">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-600">
            {isSet ? "New PIN" : "PIN"}
          </span>
          <input
            name="pin"
            inputMode="numeric"
            autoComplete="off"
            value={pin}
            onChange={(e) => setPin(onlyDigits(e.target.value))}
            placeholder="••••"
            className="w-28 rounded-md border border-slate-300 px-3 py-2 text-center text-lg tracking-[0.4em] shadow-sm"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-600">Confirm</span>
          <input
            name="confirm"
            inputMode="numeric"
            autoComplete="off"
            value={confirm}
            onChange={(e) => setConfirm(onlyDigits(e.target.value))}
            placeholder="••••"
            className="w-28 rounded-md border border-slate-300 px-3 py-2 text-center text-lg tracking-[0.4em] shadow-sm"
          />
        </label>
        <button
          type="submit"
          disabled={pending || pin.length !== 4 || confirm.length !== 4}
          className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
        >
          {isSet ? "Change PIN" : "Turn on lock"}
        </button>
      </form>

      <div className="mt-2 h-4 text-xs">
        {state.error && <span className="text-red-600">{state.error}</span>}
        {state.ok && <span className="text-green-600">Saved. The new PIN is active.</span>}
      </div>

      {isSet && (
        <form action={disableHouseholdPin} className="mt-2">
          <button
            type="submit"
            className="text-xs font-medium text-slate-500 hover:text-red-600"
            onClick={(e) => {
              if (!window.confirm("Turn off the app lock for everyone?")) e.preventDefault();
            }}
          >
            Turn off app lock
          </button>
        </form>
      )}
    </section>
  );
}
