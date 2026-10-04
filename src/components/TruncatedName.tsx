"use client";

import { useEffect, useRef, useState } from "react";

// A name that ellipsis-truncates to fit its row, but reveals the FULL text in a small popup when the
// truncated name is tapped (mobile) or hovered (desktop `title`). No popup when the text already fits —
// so it only gets in the way when it's actually needed. Closes on the next tap anywhere.
export function TruncatedName({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [truncated, setTruncated] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const check = () => {
      const el = ref.current;
      if (el) setTruncated(el.scrollWidth > el.clientWidth + 1);
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [text]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    // defer so the opening tap itself doesn't immediately close it
    const t = window.setTimeout(() => document.addEventListener("click", close), 0);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("click", close);
    };
  }, [open]);

  return (
    <span className="relative min-w-0">
      <span
        ref={ref}
        className={`block truncate ${className ?? ""}${truncated ? " cursor-pointer" : ""}`}
        title={truncated ? text : undefined}
        onClick={truncated ? (e) => { e.stopPropagation(); setOpen((o) => !o); } : undefined}
      >
        {text}
      </span>
      {open && (
        <span className="absolute left-0 top-full z-30 mt-1 max-w-[70vw] whitespace-normal break-words rounded-lg bg-slate-800 px-2.5 py-1.5 text-xs font-medium leading-snug text-white shadow-lg">
          {text}
        </span>
      )}
    </span>
  );
}
