"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type Member = { id: number; name: string };

// Soft avatar tints, picked by member id so a person keeps the same colour across the app.
const TINTS = [
  "bg-indigo-100 text-indigo-600",
  "bg-amber-100 text-amber-700",
  "bg-emerald-100 text-emerald-700",
  "bg-rose-100 text-rose-600",
  "bg-violet-100 text-violet-600",
  "bg-teal-100 text-teal-700",
  "bg-sky-100 text-sky-700",
  "bg-orange-100 text-orange-700",
];
const tintOf = (id: number) => TINTS[id % TINTS.length];

function Avatar({ member }: { member: Member | null }) {
  if (!member) return <span className="grid h-5 w-5 place-items-center rounded-full bg-slate-100 text-[10px] text-slate-400">∗</span>;
  return (
    <span className={`grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold ${tintOf(member.id)}`}>
      {member.name.charAt(0).toUpperCase()}
    </span>
  );
}

// Cute dropdown to filter every category's spends to one member (or Everyone). URL-driven (?member=),
// so it preserves the month + sort and plays nicely with browser back/forward.
export function ExpensesMemberFilter({ members, selectedId }: { members: Member[]; selectedId: number | null }) {
  const router = useRouter();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open]);

  const pick = (id: number | null) => {
    const next = new URLSearchParams(params.toString());
    if (id == null) next.delete("member");
    else next.set("member", String(id));
    router.replace(`/expenses?${next.toString()}`, { scroll: false });
    setOpen(false);
  };

  const selected = selectedId != null ? members.find((m) => m.id === selectedId) ?? null : null;

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`inline-flex items-center gap-1.5 rounded-lg border bg-white py-1 pl-1.5 pr-2 text-xs font-medium transition ${
          selected ? "border-indigo-200 text-indigo-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"
        }`}
      >
        <Avatar member={selected} />
        <span className="max-w-24 truncate">{selected ? selected.name : "Everyone"}</span>
        <span className={`text-[9px] text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 z-30 mt-1 max-h-72 w-44 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg"
        >
          <button
            type="button"
            role="option"
            aria-selected={selected == null}
            onClick={() => pick(null)}
            className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs ${selected == null ? "bg-indigo-50 font-semibold text-indigo-700" : "text-slate-600 hover:bg-slate-50"}`}
          >
            <Avatar member={null} />
            Everyone
          </button>
          {members.map((m) => (
            <button
              key={m.id}
              type="button"
              role="option"
              aria-selected={selectedId === m.id}
              onClick={() => pick(m.id)}
              className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs ${selectedId === m.id ? "bg-indigo-50 font-semibold text-indigo-700" : "text-slate-600 hover:bg-slate-50"}`}
            >
              <Avatar member={m} />
              <span className="truncate">{m.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
