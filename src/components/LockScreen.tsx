"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { startAuthentication } from "@simplewebauthn/browser";
import { verifyPin, type UnlockState } from "@/app/lock/actions";

const INITIAL: UnlockState = { ok: false };

export function LockScreen({
  householdName,
  greetingName,
  hasBiometric,
}: {
  householdName: string;
  greetingName: string | null;
  hasBiometric: boolean;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(verifyPin, INITIAL);
  const [pin, setPin] = useState("");
  const [remaining, setRemaining] = useState(0);
  const [bioError, setBioError] = useState<string | null>(null);
  const [bioBusy, setBioBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const autoTried = useRef(false);

  // success → into the app
  useEffect(() => {
    if (state.ok) router.replace("/");
  }, [state.ok, router]);

  // wrong / locked → clear the entered digits
  useEffect(() => {
    if (!state.ok && (state.error || state.lockedMs)) setPin("");
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

  const press = (d: string) => {
    if (disabled) return;
    setPin((p) => (p.length >= 4 ? p : p + d));
  };

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
      if (data.verified) router.replace("/");
      else throw new Error(data.error ?? "Biometric didn’t match.");
    } catch (e) {
      setBioError(e instanceof Error ? e.message : "Biometric unavailable.");
    } finally {
      setBioBusy(false);
    }
  };

  // Prompt biometric automatically on open — the PIN pad is the fallback.
  useEffect(() => {
    if (hasBiometric && !autoTried.current) {
      autoTried.current = true;
      void doBiometric();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasBiometric]);

  return (
    <div className="w-full max-w-xs text-center">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#3f6152] text-white shadow-sm">
        <LockGlyph />
      </div>
      <h1 className="mt-5 font-display text-2xl text-[#1c1c1a]">
        {greetingName ? `Welcome back, ${greetingName.split(" ")[0]}` : "Welcome back"}
      </h1>
      <p className="mt-1 text-[14px] text-[#8a877f]">Enter your {householdName} PIN</p>

      {/* dots */}
      <div className="mt-7 flex justify-center gap-3.5" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={`h-3.5 w-3.5 rounded-full transition-colors ${
              i < pin.length ? "bg-[#3f6152]" : "bg-[#dcd9d0]"
            }`}
          />
        ))}
      </div>

      {/* status line */}
      <div className="mt-4 h-5 text-[13px]">
        {locked ? (
          <span className="text-[#b4685a]">Try again in {remaining}s</span>
        ) : state.error ? (
          <span className="text-[#b4685a]">{state.error}</span>
        ) : (
          <span className="text-transparent">·</span>
        )}
      </div>

      {/* hidden form drives the server action */}
      <form ref={formRef} action={formAction} className="hidden">
        <input type="hidden" name="pin" value={pin} readOnly />
      </form>

      {/* keypad — biometric is prompted automatically on open, not a key here */}
      <div className="mt-2 grid grid-cols-3 gap-3">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <Key key={d} onClick={() => press(d)} disabled={disabled}>
            {d}
          </Key>
        ))}
        <span />
        <Key onClick={() => press("0")} disabled={disabled}>
          0
        </Key>
        <Key onClick={() => setPin((p) => p.slice(0, -1))} disabled={disabled} subtle aria-label="Delete">
          ⌫
        </Key>
      </div>

      {/* retry biometric (shown only if this device has it enrolled) */}
      {hasBiometric && (
        <button
          type="button"
          onClick={doBiometric}
          disabled={bioBusy || pending}
          className="mt-6 inline-flex items-center gap-2 text-[14px] font-medium text-[#3f6152] disabled:opacity-50"
        >
          <FaceIcon />
          {bioBusy ? "Waiting for biometric…" : "Use Face ID / fingerprint"}
        </button>
      )}

      {bioError && <p className="mt-3 text-[13px] text-[#b4685a]">{bioError}</p>}

      <p className="mt-8 text-[12.5px] text-[#a9a69d]">
        Forgot the PIN? Ask the head of your household to reset it in Setup.
      </p>
    </div>
  );
}

function Key({
  children,
  onClick,
  disabled,
  subtle = false,
  ...rest
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  subtle?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`mx-auto grid h-16 w-16 place-items-center rounded-full text-2xl font-medium transition active:scale-95 disabled:opacity-40 ${
        subtle
          ? "text-[#8a877f] hover:bg-black/5"
          : "bg-white text-[#26251f] shadow-sm ring-1 ring-black/5 hover:bg-[#f4f2ec]"
      }`}
      {...rest}
    >
      {children}
    </button>
  );
}

function LockGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="5" y="11" width="14" height="9" rx="2.2" fill="currentColor" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="2" />
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
