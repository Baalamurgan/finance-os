"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { startRegistration } from "@simplewebauthn/browser";
import { doSignOut, setViewAs } from "@/app/actions";
import { lockNow, removeMyBiometric } from "@/app/lock/actions";
import { ThemeMenuRow } from "@/components/ThemeToggle";

export function UserMenu({
  name,
  email,
  image,
  role,
  canEdit = false,
  navQuery = "",
  activeAdmin,
  pinEnabled = false,
  hasBiometric = false,
  actualIsHead = false,
  viewingAsMember = false,
}: {
  name: string;
  email: string;
  image: string | null;
  role: string;
  canEdit?: boolean;
  navQuery?: string;
  activeAdmin?: string;
  pinEnabled?: boolean;
  hasBiometric?: boolean;
  actualIsHead?: boolean;
  viewingAsMember?: boolean;
}) {
  const isHead = role === "head";
  // Admin-ish destinations moved out of the nav bar: Wind Down (everyone), Setup
  // (head + manager), Settings = members + app lock (head only).
  const adminLinks = [
    { key: "wind-down", label: "Wind Down", href: "/wind-down", icon: "🌙", show: true },
    { key: "setup", label: "Setup · budgets & bills", href: "/setup", icon: "⚙️", show: canEdit },
    { key: "users", label: "Settings · members & lock", href: "/users", icon: "🔧", show: isHead },
  ].filter((l) => l.show);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);
  const [bioMsg, setBioMsg] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const enrollBiometric = async () => {
    setBioBusy(true);
    setBioMsg(null);
    try {
      const optRes = await fetch("/api/webauthn/register/options", { method: "POST" });
      if (!optRes.ok) throw new Error("Couldn’t start biometric setup.");
      const options = await optRes.json();
      const attestation = await startRegistration(options);
      const verifyRes = await fetch("/api/webauthn/register/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...attestation, deviceLabel: navigator.platform || "This device" }),
      });
      const data = await verifyRes.json();
      if (data.verified) {
        setBioMsg("Biometric unlock enabled.");
        router.refresh();
      } else throw new Error(data.error ?? "Setup failed.");
    } catch (e) {
      setBioMsg(e instanceof Error ? e.message : "Biometric unavailable on this device.");
    } finally {
      setBioBusy(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const initial = (name || email || "?").trim().charAt(0).toUpperCase();

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex shrink-0 items-center gap-2 rounded-full border border-slate-200 py-1 pl-1 pr-2 transition hover:bg-slate-50 sm:pr-2.5"
      >
        <Avatar name={name} email={email} image={image} initial={initial} />
        <span className="hidden max-w-[8rem] truncate text-sm font-medium text-slate-700 sm:inline">
          {name}
        </span>
        <svg width="14" height="14" viewBox="0 0 20 20" className="text-slate-400">
          <path fill="currentColor" d="M5 7l5 5 5-5z" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center gap-3 border-b border-slate-100 p-4">
            <Avatar name={name} email={email} image={image} initial={initial} size="lg" />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-slate-800">{name}</div>
              <div className="truncate text-xs text-slate-500">{email}</div>
              <span
                className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  role === "head"
                    ? "bg-indigo-100 text-indigo-700"
                    : "bg-slate-100 text-slate-600"
                }`}
              >
                {role === "head" ? "Head of family" : "Member"}
              </span>
            </div>
          </div>
          <Link
            href="/personal/expenses"
            onClick={() => setOpen(false)}
            className="flex w-full items-center gap-2 border-b border-slate-100 px-4 py-3 text-left text-sm font-medium text-emerald-700 hover:bg-emerald-50"
          >
            <span className="text-base leading-none">🔒</span>
            Switch to Personal →
          </Link>
          {adminLinks.length > 0 && (
            <div className="border-b border-slate-100 py-1">
              {adminLinks.map((l) => (
                <Link
                  key={l.key}
                  href={`${l.href}${navQuery}`}
                  onClick={() => setOpen(false)}
                  className={`flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm ${
                    activeAdmin === l.key ? "bg-indigo-50 font-medium text-indigo-700" : "text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <span className="text-base leading-none">{l.icon}</span>
                  {l.label}
                </Link>
              ))}
            </div>
          )}
          <div className="border-b border-slate-100">
            <ThemeMenuRow />
          </div>
          {actualIsHead && (
            <form action={setViewAs} className="border-b border-slate-100">
              <input type="hidden" name="mode" value={viewingAsMember ? "head" : "member"} />
              <button className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-slate-700 hover:bg-slate-50">
                <span className="text-base leading-none">👀</span>
                {viewingAsMember ? "Exit member view (back to head)" : "View as member (read-only)"}
              </button>
            </form>
          )}
          {pinEnabled && (
            <div className="border-b border-slate-100">
              {hasBiometric ? (
                <form action={removeMyBiometric}>
                  <button className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-slate-700 hover:bg-slate-50">
                    <FaceGlyph />
                    Turn off biometric unlock
                  </button>
                </form>
              ) : (
                <button
                  onClick={enrollBiometric}
                  disabled={bioBusy}
                  className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  <FaceGlyph />
                  {bioBusy ? "Setting up…" : "Enable Face ID / fingerprint"}
                </button>
              )}
              {bioMsg && <p className="px-4 pb-2 text-xs text-slate-500">{bioMsg}</p>}
              <form action={lockNow}>
                <button className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-slate-700 hover:bg-slate-50">
                  <LockGlyph />
                  Lock now
                </button>
              </form>
            </div>
          )}
          <form action={doSignOut}>
            <button className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-slate-700 hover:bg-slate-50">
              <svg width="16" height="16" viewBox="0 0 24 24" className="text-slate-400">
                <path
                  fill="currentColor"
                  d="M16 17v-3H9v-4h7V7l5 5-5 5M14 2a2 2 0 0 1 2 2v2h-2V4H5v16h9v-2h2v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9z"
                />
              </svg>
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function FaceGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-slate-400" aria-hidden>
      <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M9 10v1M15 10v1M10 15s.8.8 2 .8 2-.8 2-.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function LockGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-slate-400" aria-hidden>
      <rect x="5" y="11" width="14" height="9" rx="2" fill="currentColor" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function Avatar({
  name,
  email,
  image,
  initial,
  size = "sm",
}: {
  name: string;
  email: string;
  image: string | null;
  initial: string;
  size?: "sm" | "lg";
}) {
  const dim = size === "lg" ? "h-10 w-10 text-base" : "h-7 w-7 text-xs";
  if (image) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={image}
        alt={name || email}
        className={`${dim} shrink-0 rounded-full object-cover`}
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <span
      className={`${dim} flex shrink-0 items-center justify-center rounded-full bg-indigo-600 font-semibold text-white`}
    >
      {initial}
    </span>
  );
}
