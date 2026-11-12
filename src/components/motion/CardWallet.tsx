"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { heroLaunch } from "@/components/motion/Hero";

// A wallet of the cards, drawn like real cards in a stack. Flick the top card aside (or use the arrows /
// ← →) to bring the next one up; tap it to turn it over and read its details on the back. Each card wears
// its own colour (the one picked when it was added). Pure presentation — no data changes here.

export type WalletCard = {
  id: number;
  name: string;
  color: string;
  last4: string | null;
  holder: string;
  kind: string; // "Credit" · "Debit" · "Prepaid"
  network: string | null;
  institution: string | null;
  status?: { text: string; tone: "due" | "ok" | "muted" } | null; // caption under the stack
  back?: { label: string; value: string }[];
  href?: string; // "Open" on the back
};

const FLING_PX = 80;

export function shade(hex: string, amt: number) {
  const m = hex.replace("#", "").match(/^([0-9a-f]{6}|[0-9a-f]{3})$/i);
  if (!m) return hex;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  const ch = (s: number) => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * (1 + amt))));
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}

export function CardWallet({ cards }: { cards: WalletCard[] }) {
  const [order, setOrder] = useState(() => cards.map((_, i) => i));
  const [flipped, setFlipped] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const drag = useRef<{ x0: number; y0: number; dx: number; t0: number; moved: boolean; id: number } | null>(null);

  // Cards list changed (added/removed) → reset the order.
  const sig = cards.map((c) => c.id).join(",");
  const [prevSig, setPrevSig] = useState(sig);
  if (sig !== prevSig) { setPrevSig(sig); setOrder(cards.map((_, i) => i)); setFlipped(false); }

  // Throw the top card off to one side, then tuck it in at the back of the stack.
  const fling = useCallback((dir: 1 | -1) => {
    const el = topRef.current;
    if (!el || busy.current || cards.length < 2) return;
    setFlipped(false);
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { setOrder((o) => [...o.slice(1), o[0]]); return; }
    busy.current = true;
    el.style.transition = "translate 0.24s ease-in, rotate 0.24s ease-in, opacity 0.24s ease-in";
    el.style.translate = `${dir * 420}px -10px`;
    el.style.rotate = `${dir * 22}deg`;
    el.style.opacity = "0";
    window.setTimeout(() => {
      el.style.transition = "none"; // re-enter at the back without sweeping across the stack
      el.style.translate = "";
      el.style.rotate = "";
      el.style.opacity = "";
      setOrder((o) => [...o.slice(1), o[0]]);
      requestAnimationFrame(() => requestAnimationFrame(() => { el.style.transition = ""; busy.current = false; }));
    }, 240);
  }, [cards.length]);

  const back = useCallback(() => {
    if (busy.current || cards.length < 2) return;
    setFlipped(false);
    setOrder((o) => [o[o.length - 1], ...o.slice(0, -1)]); // the back card glides forward
  }, [cards.length]);

  if (cards.length === 0) return null;
  const top = cards[order[0]];

  const onDown = (e: React.PointerEvent) => {
    if (busy.current) return;
    drag.current = { x0: e.clientX, y0: e.clientY, dx: 0, t0: performance.now(), moved: false, id: e.pointerId };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const el = topRef.current;
    if (!d || !el || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    if (!d.moved) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      if (Math.abs(dy) > Math.abs(dx)) { drag.current = null; return; } // a vertical scroll, not a flick
      d.moved = true;
      el.setPointerCapture(e.pointerId);
    }
    d.dx = dx;
    el.style.transition = "none";
    el.style.translate = `${dx}px ${Math.abs(dx) * -0.04}px`;
    el.style.rotate = `${dx / 18}deg`;
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    const el = topRef.current;
    if (!d || !el) return;
    if (!d.moved) { setFlipped((f) => !f); return; } // a tap turns the card over
    const v = Math.abs(d.dx) / Math.max(1, performance.now() - d.t0);
    if (cards.length > 1 && (Math.abs(d.dx) > FLING_PX || v > 0.6)) {
      fling(d.dx > 0 ? 1 : -1);
    } else {
      el.style.transition = "translate 0.45s cubic-bezier(0.34, 1.56, 0.64, 1), rotate 0.45s cubic-bezier(0.34, 1.56, 0.64, 1)";
      el.style.translate = "";
      el.style.rotate = "";
      window.setTimeout(() => { if (!busy.current) el.style.transition = ""; }, 460);
    }
  };

  const visible = order.slice(0, Math.min(4, order.length));

  return (
    <div
      className="select-none"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") fling(1);
        else if (e.key === "ArrowLeft") back();
        else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setFlipped((f) => !f); }
      }}
      aria-roledescription="card wallet"
      aria-label={`${top.name}, card ${order[0] + 1} of ${cards.length}. Left and right arrows switch cards, Enter turns it over.`}
    >
      <div className="relative mx-auto aspect-[1.586] w-full max-w-[22rem] [perspective:1200px]" style={{ marginTop: (visible.length - 1) * 10 }}>
        {[...visible].reverse().map((idx) => {
          const depth = visible.indexOf(idx);
          const c = cards[idx];
          const isTop = depth === 0;
          return (
            <div
              key={c.id}
              data-hero-card
              ref={isTop ? topRef : undefined}
              onPointerDown={isTop ? onDown : undefined}
              onPointerMove={isTop ? onMove : undefined}
              onPointerUp={isTop ? onUp : undefined}
              onPointerCancel={isTop ? () => { drag.current = null; } : undefined}
              className={`absolute inset-0 transition-[transform,opacity] duration-[450ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${isTop ? "cursor-grab touch-pan-y active:cursor-grabbing" : "pointer-events-none"}`}
              style={{
                zIndex: 10 - depth,
                transform: `translateY(${-depth * 10}px) scale(${1 - depth * 0.055})`,
                opacity: depth > 2 ? 0 : 1 - depth * 0.12,
                filter: depth ? `brightness(${1 - depth * 0.08})` : undefined,
              }}
            >
              <div
                className="relative h-full w-full [transform-style:preserve-3d]"
                style={{ transform: isTop && flipped ? "rotateY(180deg)" : "none", transition: "transform 0.6s cubic-bezier(0.3, 1.3, 0.5, 1)" }}
              >
                <CardFace c={c} />
                <CardBack c={c} open={isTop && flipped} />
              </div>
            </div>
          );
        })}
      </div>

      {/* caption + controls */}
      <div className="mx-auto mt-4 flex max-w-[22rem] items-center gap-3">
        <button type="button" onClick={back} disabled={cards.length < 2} aria-label="Previous card"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-slate-200 bg-white text-slate-500 hover:text-slate-800 disabled:opacity-30">
          <svg width="14" height="14" viewBox="0 0 20 20" aria-hidden><path fill="currentColor" d="M12.5 4.5 7 10l5.5 5.5-1.4 1.4L4.2 10l6.9-6.9z" /></svg>
        </button>
        <div key={top.id} className="fo-swap-in min-w-0 flex-1 text-center">
          <div className="truncate text-sm font-semibold text-slate-800">{top.name}</div>
          {top.status ? (
            <div className={`truncate text-xs ${top.status.tone === "due" ? "text-red-600" : top.status.tone === "ok" ? "text-emerald-600" : "text-slate-500"}`}>{top.status.text}</div>
          ) : (
            <div className="truncate text-xs text-slate-500">{top.holder} · {top.kind}</div>
          )}
          {cards.length > 1 && (
            <div className="mt-1.5 flex justify-center gap-1" aria-hidden>
              {cards.map((c, i) => (
                <span key={c.id} className={`h-1 rounded-full transition-all duration-300 ${order[0] === i ? "w-4 bg-slate-700" : "w-1 bg-slate-300"}`} />
              ))}
            </div>
          )}
        </div>
        <button type="button" onClick={() => fling(1)} disabled={cards.length < 2} aria-label="Next card"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-slate-200 bg-white text-slate-500 hover:text-slate-800 disabled:opacity-30">
          <svg width="14" height="14" viewBox="0 0 20 20" aria-hidden><path fill="currentColor" d="M7.5 4.5 13 10l-5.5 5.5 1.4 1.4 6.9-6.9-6.9-6.9z" /></svg>
        </button>
      </div>
      <p className="mt-2 text-center text-[11px] text-slate-400">Flick a card aside for the next · tap to turn it over</p>
    </div>
  );
}

export function CardFace({ c }: { c: WalletCard }) {
  return (
    <div
      className="absolute inset-0 overflow-hidden rounded-2xl p-4 text-[#fff] shadow-[0_18px_40px_-14px_rgba(15,23,42,0.55)] [backface-visibility:hidden] sm:p-5"
      style={{ background: `linear-gradient(135deg, ${shade(c.color, 0.12)} 0%, ${c.color} 45%, ${shade(c.color, -0.45)} 100%)` }}
    >
      {/* sheen + soft rings for depth */}
      <span aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-[#fff]/10" />
      <span aria-hidden className="pointer-events-none absolute -bottom-24 -left-10 h-56 w-56 rounded-full bg-black/10" />
      <span aria-hidden className="fo-card-sheen pointer-events-none absolute inset-0" />

      <div className="relative flex h-full flex-col">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold leading-tight drop-shadow-sm">{c.name}</div>
            <div className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-[#fff]/70">{[c.kind, c.institution].filter(Boolean).join(" · ")}</div>
          </div>
          <svg width="22" height="22" viewBox="0 0 24 24" className="shrink-0 text-[#fff]/80" aria-hidden>
            <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" d="M8.5 7.5a6 6 0 0 1 0 9M12 5a9.5 9.5 0 0 1 0 14M15.5 2.8a13 13 0 0 1 0 18.4" />
          </svg>
        </div>

        {/* chip */}
        <div className="mt-3 h-7 w-10 rounded-md bg-gradient-to-br from-amber-200 via-yellow-300 to-amber-500 p-[3px] shadow-inner sm:mt-4">
          <div className="grid h-full w-full grid-cols-3 gap-[2px] rounded-[3px] opacity-60">
            {Array.from({ length: 6 }).map((_, i) => <span key={i} className="rounded-[1px] border border-amber-700/40" />)}
          </div>
        </div>

        <div className="mt-auto">
          <div className="font-mono text-[15px] tracking-[0.18em] drop-shadow-sm sm:text-base">
            •••• •••• •••• <span className="font-semibold">{c.last4 ?? "····"}</span>
          </div>
          <div className="mt-2 flex items-end justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[9px] uppercase tracking-[0.16em] text-[#fff]/60">Holder</div>
              <div className="truncate text-xs font-medium">{c.holder}</div>
            </div>
            {c.network && <div className="shrink-0 text-sm font-extrabold uppercase italic tracking-wide text-[#fff]/90">{c.network}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function CardBack({ c, open }: { c: WalletCard; open: boolean }) {
  const rows = c.back ?? [
    { label: "Type", value: c.kind },
    { label: "Holder", value: c.holder },
    ...(c.institution ? [{ label: "Bank", value: c.institution }] : []),
    ...(c.network ? [{ label: "Network", value: c.network.toUpperCase() }] : []),
    ...(c.last4 ? [{ label: "Ends in", value: c.last4 }] : []),
  ];
  return (
    <div
      className="absolute inset-0 overflow-hidden rounded-2xl text-[#fff] shadow-[0_18px_40px_-14px_rgba(15,23,42,0.55)] [backface-visibility:hidden] [transform:rotateY(180deg)]"
      style={{ background: `linear-gradient(225deg, ${shade(c.color, -0.2)} 0%, ${shade(c.color, -0.55)} 100%)` }}
    >
      <div className="mt-4 h-9 w-full bg-black/45" aria-hidden />
      <div className="space-y-1 px-4 pt-3 sm:px-5">
        {rows.slice(0, 4).map((r) => (
          <div key={r.label} className="flex items-baseline justify-between gap-3 text-xs">
            <span className="text-[#fff]/60">{r.label}</span>
            <span className="truncate font-medium tabular-nums">{r.value}</span>
          </div>
        ))}
      </div>
      {c.href && (
        <Link
          href={c.href}
          // the card zooms into the account page (turning face-up on the way)
          onClick={(e) => { const card = e.currentTarget.closest("[data-hero-card]"); if (card instanceof HTMLElement && c.href) heroLaunch(c.href, card, { unflip: true }); }}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          tabIndex={open ? 0 : -1}
          aria-hidden={!open}
          className={`absolute bottom-3 right-4 ${open ? "" : "pointer-events-none"} rounded-full bg-[#fff]/90 px-3 py-1 text-xs font-semibold text-[#0f172a] shadow hover:bg-[#fff]`}
        >
          Open ›
        </Link>
      )}
    </div>
  );
}
