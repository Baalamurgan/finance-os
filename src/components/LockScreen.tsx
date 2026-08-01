"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { startAuthentication } from "@simplewebauthn/browser";
import { verifyPin, switchToPersonal, type UnlockState } from "@/app/lock/actions";

const INITIAL: UnlockState = { ok: false };

export function LockScreen({
  householdName,
  greetingName,
  hasBiometric,
  next = "/",
}: {
  householdName: string;
  greetingName: string | null;
  hasBiometric: boolean;
  next?: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(verifyPin, INITIAL);
  const [pin, setPin] = useState("");
  const [remaining, setRemaining] = useState(0);
  const [bioError, setBioError] = useState<string | null>(null);
  const [bioBusy, setBioBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const pinRef = useRef<HTMLInputElement>(null);
  const autoTried = useRef(false);

  // A correct PIN redirects from the server action itself (atomic cookie + nav),
  // so there's no client-side success navigation to race here.

  // wrong / locked → clear the entered digits
  useEffect(() => {
    if (!state.ok && (state.error || state.lockedMs)) {
      setPin("");
      if (!state.lockedMs) pinRef.current?.focus();
    }
  }, [state]);

  // lockout countdown
  useEffect(() => {
    if (!state.lockedMs) {
      setRemaining(0);
      return;
    }
    setRemaining(Math.ceil(state.lockedMs / 1000));
    const t = setInterval(() => setRemaining((r) => (r <= 1 ? 0 : r - 1)), 1000);
    return () => clearInterval(t);
  }, [state.lockedMs]);

  const locked = remaining > 0;
  const disabled = pending || locked;

  // auto-submit once four digits are in
  useEffect(() => {
    if (pin.length === 4 && !disabled) formRef.current?.requestSubmit();
  }, [pin, disabled]);

  const doBiometric = async () => {
    setBioError(null);
    setBioBusy(true);
    try {
      const optRes = await fetch("/api/webauthn/authenticate/options", { method: "POST" });
      if (!optRes.ok) throw new Error("Couldn’t start biometric.");
      const options = await optRes.json();
      const assertion = await startAuthentication(options);
      const verifyRes = await fetch("/api/webauthn/authenticate/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(assertion),
      });
      const data = await verifyRes.json();
      if (data.verified) router.replace(next);
      else throw new Error(data.error ?? "Biometric didn’t match.");
    } catch (e) {
      setBioError(e instanceof Error ? e.message : "Biometric unavailable.");
    } finally {
      setBioBusy(false);
      pinRef.current?.focus(); // re-open the number pad if biometric was dismissed
    }
  };

  // Open the device number pad by default, and still offer biometric on top.
  useEffect(() => {
    pinRef.current?.focus();
    if (hasBiometric && !autoTried.current) {
      autoTried.current = true;
      void doBiometric();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasBiometric]);

  return (
    <div className="w-full max-w-xs text-center">
      <div className="mx-auto grid h-16 w-16 place-items-center rounded-[1.35rem] bg-[#3f6152] text-white shadow-lg shadow-[#3f6152]/20">
        <LockGlyph />
      </div>
      <h1 className="mt-6 font-display text-2xl text-[#1c1c1a]">
        {greetingName ? `Welcome back, ${greetingName.split(" ")[0]}` : "Welcome back"}
      </h1>
      <p className="mt-1.5 text-[14px] text-[#8a877f]">Enter your {householdName} PIN to unlock</p>

      {/* PIN dots — tapping anywhere here focuses the hidden numeric field, so the
          device's own number pad handles entry (no in-app keypad). */}
      <button
        type="button"
        onClick={() => pinRef.current?.focus()}
        disabled={disabled}
        aria-label="Enter PIN"
        className="relative mx-auto mt-9 flex w-max justify-center gap-4 rounded-2xl px-3 py-2"
      >
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={`h-4 w-4 rounded-full transition-all ${
              i < pin.length
                ? "scale-100 bg-[#3f6152]"
                : i === pin.length && !locked
                  ? "bg-transparent ring-2 ring-[#3f6152]/50"
                  : "bg-[#dcd9d0]"
            }`}
          />
        ))}
        <input
          ref={pinRef}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
          inputMode="numeric"
          autoComplete="off"
          enterKeyHint="done"
          autoFocus
          aria-hidden
          disabled={disabled}
          className="absolute inset-0 h-full w-full cursor-pointer text-[16px] opacity-0"
        />
      </button>

      {/* status line */}
      <div className="mt-4 h-5 text-[13px]">
        {locked ? (
          <span className="text-[#b4685a]">Try again in {remaining}s</span>
        ) : state.error ? (
          <span className="text-[#b4685a]">{state.error}</span>
        ) : pending ? (
          <span className="text-[#8a877f]">Checking…</span>
        ) : (
          <span className="text-transparent">·</span>
        )}
      </div>

      {/* obvious tap target — on phones the keyboard only opens on a real tap */}
      {!locked && pin.length === 0 && (
        <button
          type="button"
          onClick={() => pinRef.current?.focus()}
          disabled={disabled}
          className="mt-1 inline-flex items-center gap-2 rounded-full bg-[#3f6152] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition active:scale-95 disabled:opacity-50"
        >
          <KeypadIcon /> Tap to enter PIN
        </button>
      )}

      {/* hidden form drives the server action */}
      <form ref={formRef} action={formAction} className="hidden">
        <input type="hidden" name="pin" value={pin} readOnly />
        <input type="hidden" name="next" value={next} readOnly />
      </form>

      {/* biometric (shown only if this device has it enrolled) */}
      {hasBiometric && (
        <button
          type="button"
          onClick={doBiometric}
          disabled={bioBusy || pending}
          className="mt-8 inline-flex items-center gap-2 text-[14px] font-medium text-[#3f6152] disabled:opacity-50"
        >
          <FaceIcon />
          {bioBusy ? "Waiting for biometric…" : "Use Face ID / fingerprint"}
        </button>
      )}

      {bioError && <p className="mt-3 text-[13px] text-[#b4685a]">{bioError}</p>}

      {/* switch modes without unlocking — mirrors Personal's "Use Family instead" */}
      <form action={switchToPersonal} className="mt-8">
        <button type="submit" className="text-[13px] font-medium text-[#3f6152]/80 hover:text-[#3f6152]">
          Use Personal instead →
        </button>
      </form>

      <p className="mt-6 text-[12.5px] text-[#a9a69d]">
        Forgot the PIN? Ask the head of your household to reset it in Setup.
      </p>
    </div>
  );
}

function LockGlyph() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="5" y="11" width="14" height="9" rx="2.2" fill="currentColor" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function KeypadIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      {[6, 12, 18].map((cy) => [6, 12, 18].map((cx) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.6" />))}
    </svg>
  );
}

function FaceIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M9 10v1M15 10v1M12 10v2.5M10 15s.8.8 2 .8 2-.8 2-.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
