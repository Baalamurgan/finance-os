"use client";

import { useEffect, useRef, useState } from "react";
import { doSignOut } from "@/app/actions";

export function UserMenu({
  name,
  email,
  image,
  role,
}: {
  name: string;
  email: string;
  image: string | null;
  role: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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
        className="flex items-center gap-2 rounded-full border border-slate-200 py-1 pl-1 pr-2.5 transition hover:bg-slate-50"
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
        className={`${dim} rounded-full object-cover`}
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <span
      className={`${dim} flex items-center justify-center rounded-full bg-indigo-600 font-semibold text-white`}
    >
      {initial}
    </span>
  );
}
