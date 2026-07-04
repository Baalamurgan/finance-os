"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { startRegistration } from "@simplewebauthn/browser";
import { setPersonalPin, removePersonalBiometric, type PersonalPinAdminState } from "@/app/personal/lock/actions";
import { useToast } from "@/components/Toast";

const INIT: PersonalPinAdminState = { ok: false };

export function PersonalSecurity({ hasBiometric }: { hasBiometric: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [state, formAction, pending] = useActionState(setPersonalPin, INIT);
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [bioBusy, setBioBusy] = useState(false);
  const digits = (v: string) => v.replace(/\D/g, "").slice(0, 4);

  useEffect(() => {
    if (state.ok) {
      setPin("");
      setConfirm("");
      toast("Personal PIN updated", "success");
      router.refresh();
    } else if (state.error) toast(state.error, "error");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const enroll = async () => {
    setBioBusy(true);
    try {
      const o = await fetch("/api/personal/webauthn/register/options", { method: "POST" });
      if (!o.ok) throw new Error("Couldn’t start.");
      const options = await o.json();
      const att = await startRegistration(options);
      const v = await fetch("/api/personal/webauthn/register/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...att, deviceLabel: navigator.platform || "This device" }),
      });
      const data = await v.json();
      if (data.verified) {
        toast("Biometric enabled", "success");
        router.refresh();
      } else throw new Error(data.error ?? "Failed.");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Biometric unavailable.", "error");
    } finally {
      setBioBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-900">Personal lock</h2>
      <p className="mt-0.5 text-xs text-slate-500">Your own PIN + biometric, separate from the family lock.</p>

      <form action={formAction} className="mt-3 flex flex-wrap items-end gap-2">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-slate-500">New PIN</span>
          <input name="pin" inputMode="numeric" value={pin} onChange={(e) => setPin(digits(e.target.value))} placeholder="••••" className="input w-24 text-center tracking-[0.3em]" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-slate-500">Confirm</span>
          <input name="confirm" inputMode="numeric" value={confirm} onChange={(e) => setConfirm(digits(e.target.value))} placeholder="••••" className="input w-24 text-center tracking-[0.3em]" />
        </label>
        <button disabled={pending || pin.length !== 4 || confirm.length !== 4} className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-40">
          Change PIN
        </button>
      </form>

      <div className="mt-3 border-t border-slate-100 pt-3">
        {hasBiometric ? (
          <form action={removePersonalBiometric}>
            <button className="text-sm font-medium text-slate-500 hover:text-red-600">Turn off biometric on this device</button>
          </form>
        ) : (
          <button onClick={enroll} disabled={bioBusy} className="text-sm font-medium text-emerald-700 disabled:opacity-50">
            {bioBusy ? "Setting up…" : "Enable Face ID / fingerprint"}
          </button>
        )}
      </div>
    </section>
  );
}
