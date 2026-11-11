"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { startNavProgress } from "@/components/NavProgress";

// ⌘K / Ctrl+K (or the 🔍 button): type a few letters of any page and jump straight there — the same month
// stays selected. Keyboard-first (↑ ↓ Enter, Esc), and fine with a tap too.

export type JumpItem = { key: string; label: string; href: string; icon?: string; hint?: string };

export function QuickJump({ items, q, tone = "family" }: { items: readonly JumpItem[]; q: string; tone?: "family" | "personal" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((v) => !v); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => window.clearTimeout(id);
  }, [open]);

  const list = useMemo(() => {
    const t = text.trim().toLowerCase();
    if (!t) return items;
    const score = (it: JumpItem) => {
      const l = it.label.toLowerCase();
      if (l.startsWith(t)) return 0;
      if (l.split(/\s+/).some((w) => w.startsWith(t))) return 1;
      if (l.includes(t) || (it.hint ?? "").toLowerCase().includes(t)) return 2;
      // loose: letters in order ("mp" → Money Plan)
      let i = 0;
      for (const ch of l) if (ch === t[i]) i++;
      return i === t.length ? 3 : 9;
    };
    return items.map((it) => ({ it, s: score(it) })).filter((x) => x.s < 9).sort((a, b) => a.s - b.s).map((x) => x.it);
  }, [items, text]);

  const close = () => { setOpen(false); setText(""); setSel(0); };
  const go = (it: JumpItem) => {
    close();
    startNavProgress();
    router.push(`${it.href}${q}`);
  };

  const accent = tone === "personal" ? "bg-emerald-50 text-emerald-800" : "bg-indigo-50 text-indigo-800";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Jump to a page (⌘K)"
        aria-label="Jump to a page"
        className="hidden h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-400 shadow-sm hover:text-slate-600 lg:flex"
      >
        <svg width="14" height="14" viewBox="0 0 20 20" aria-hidden><path fill="currentColor" d="M8.5 3a5.5 5.5 0 0 1 4.38 8.83l3.65 3.64-1.06 1.06-3.64-3.65A5.5 5.5 0 1 1 8.5 3zm0 1.5a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" /></svg>
        <kbd className="rounded border border-slate-200 px-1 font-sans text-[10px]">⌘K</kbd>
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/30 px-4 pt-[12vh]" onClick={close}>
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 border-b border-slate-100 px-4">
              <svg width="16" height="16" viewBox="0 0 20 20" className="shrink-0 text-slate-400" aria-hidden><path fill="currentColor" d="M8.5 3a5.5 5.5 0 0 1 4.38 8.83l3.65 3.64-1.06 1.06-3.64-3.65A5.5 5.5 0 1 1 8.5 3zm0 1.5a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" /></svg>
              <input
                ref={inputRef}
                value={text}
                onChange={(e) => { setText(e.target.value); setSel(0); }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") close();
                  else if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(list.length - 1, s + 1)); }
                  else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
                  else if (e.key === "Enter" && list[sel]) go(list[sel]);
                }}
                placeholder="Jump to…"
                className="h-12 w-full bg-transparent text-[15px] text-slate-800 outline-none placeholder:text-slate-400"
              />
              <kbd className="shrink-0 rounded border border-slate-200 px-1.5 text-[10px] text-slate-400">Esc</kbd>
            </div>
            <ul className="fo-rise max-h-80 overflow-y-auto p-1.5" role="listbox">
              {list.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-400">No page called “{text}”.</li>}
              {list.map((it, i) => (
                <li key={it.key} role="option" aria-selected={i === sel}>
                  <button
                    type="button"
                    onMouseEnter={() => setSel(i)}
                    onClick={() => go(it)}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${i === sel ? accent : "text-slate-700"}`}
                  >
                    <span className="w-5 text-center text-base leading-none" aria-hidden>{it.icon ?? "•"}</span>
                    <span className="flex-1 font-medium">{it.label}</span>
                    {it.hint && <span className="text-xs text-slate-400">{it.hint}</span>}
                    {i === sel && <span className="text-xs text-slate-400" aria-hidden>↵</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
