"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatINR } from "@/lib/format";
import { mountedLive, reducedMotion } from "@/components/motion/live";

// One overlay for the app's "money moments". Any client component fires one with fx({...}); <FxLayer/>
// (mounted once in the root layout, so it survives page changes) plays it on top of everything and then
// removes itself. Purely visual: nothing here reads or writes data. Reduced motion: nothing plays (the
// usual toasts still confirm the action).
//   coin     – Piggy deposit: a ₹ coin drops into the pig, the pig bounces (out: the coin pops back out)
//   paid     – a bill marked paid: a big tick draws itself in, with the bill's name
//   confetti – a short burst (all of the month's plan done, the month wrapped)
//   wrap     – wind-down finale: a "<Month> wrapped" card with the month in numbers

export type WrapStats = { month: string; income: number; spent: number; best: { name: string; amount: number } | null; budgets: { total: number; over: number } | null };
export type FxEvent =
  | { kind: "coin"; amount: number; out?: boolean }
  | { kind: "paid"; label: string }
  | { kind: "confetti" }
  | { kind: "wrap"; stats: WrapStats };

const EVENT = "fo:fx";
/** Give a field a short shake (a validation error). Replays if called again. */
export function shake(el: Element | null | undefined) {
  if (!el || reducedMotion()) return;
  el.classList.remove("fo-shake");
  void (el as HTMLElement).offsetWidth; // restart the animation
  el.classList.add("fo-shake");
  window.setTimeout(() => el.classList.remove("fo-shake"), 500);
}

export function fx(e: FxEvent) {
  if (typeof window === "undefined" || reducedMotion()) return;
  window.dispatchEvent(new CustomEvent<FxEvent>(EVENT, { detail: e }));
}

type Live = FxEvent & { id: number };

export function FxLayer() {
  // (items only ever arrive from browser events, so the portal below never renders on the server)
  const [items, setItems] = useState<Live[]>([]);

  useEffect(() => {
    let n = 0;
    const on = (ev: Event) => {
      const e = (ev as CustomEvent<FxEvent>).detail;
      const id = ++n;
      setItems((xs) => [...xs.filter((x) => x.kind !== e.kind), { ...e, id }]);
      if (e.kind === "wrap") return; // stays until closed
      window.setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), e.kind === "confetti" ? 2600 : 1900);
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);

  // Any form field the browser rejects on submit (required / out of range…) shakes once.
  useEffect(() => {
    const onInvalid = (e: Event) => shake(e.target as Element);
    document.addEventListener("invalid", onInvalid, true);
    return () => document.removeEventListener("invalid", onInvalid, true);
  }, []);

  // Spotlight: cards marked data-spot get a soft light that follows the pointer (desktop / mouse only).
  useEffect(() => {
    if (!window.matchMedia?.("(hover: hover) and (pointer: fine)").matches || reducedMotion()) return;
    let el: HTMLElement | null = null;
    let raf = 0;
    let x = 0, y = 0;
    const paint = () => {
      raf = 0;
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty("--spot-x", `${x - r.left}px`);
      el.style.setProperty("--spot-y", `${y - r.top}px`);
    };
    const move = (e: PointerEvent) => {
      const t = (e.target as HTMLElement | null)?.closest?.("[data-spot]") as HTMLElement | null;
      if (t !== el) {
        el?.removeAttribute("data-spot-on");
        el = t;
        el?.setAttribute("data-spot-on", "");
      }
      x = e.clientX; y = e.clientY;
      if (el && !raf) raf = requestAnimationFrame(paint);
    };
    const leave = () => { el?.removeAttribute("data-spot-on"); el = null; };
    document.addEventListener("pointermove", move, { passive: true });
    document.documentElement.addEventListener("pointerleave", leave);
    return () => {
      document.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("pointerleave", leave);
      cancelAnimationFrame(raf);
    };
  }, []);

  if (items.length === 0) return null;
  const close = (id: number) => setItems((xs) => xs.filter((x) => x.id !== id));
  return createPortal(
    <>
      {items.map((it) =>
        it.kind === "coin" ? <CoinDrop key={it.id} amount={it.amount} out={!!it.out} />
        : it.kind === "paid" ? <PaidStamp key={it.id} label={it.label} />
        : it.kind === "confetti" ? <Confetti key={it.id} />
        : <WrapCard key={it.id} stats={it.stats} onClose={() => close(it.id)} />,
      )}
    </>,
    document.body,
  );
}

// ── Piggy coin ──────────────────────────────────────────────────────────────────────────────────────────
function CoinDrop({ amount, out }: { amount: number; out: boolean }) {
  return (
    <div className="pointer-events-none fixed inset-0 z-[95] flex items-center justify-center" aria-hidden>
      <div className="relative flex flex-col items-center" style={{ animation: "fo-fx-fade 1.9s ease forwards" }}>
        <div className="relative h-28 w-28">
          {/* coin */}
          <div
            className="absolute left-1/2 top-0 z-10 -ml-5 grid h-10 w-10 place-items-center rounded-full border-2 border-amber-600 bg-gradient-to-br from-amber-200 via-amber-400 to-amber-500 text-sm font-black text-amber-800 shadow-md"
            style={{ animation: `${out ? "fo-coin-out" : "fo-coin-in"} 0.9s cubic-bezier(0.5, 0, 0.75, 0) forwards` }}
          >
            ₹
          </div>
          {/* pig */}
          <div className="absolute inset-x-0 bottom-0 text-center text-7xl leading-none drop-shadow-lg" style={{ animation: "fo-pig 1.9s ease forwards" }}>
            🐷
          </div>
        </div>
        <div
          className={`mt-2 rounded-full px-3 py-1 text-sm font-bold tabular-nums shadow-lg ${out ? "bg-white text-slate-700" : "bg-amber-500 text-white"}`}
          style={{ animation: "fo-amount-up 1.9s ease forwards" }}
        >
          {out ? "−" : "+"}{formatINR(Math.abs(amount))}
        </div>
      </div>
    </div>
  );
}

// ── Bill paid tick ──────────────────────────────────────────────────────────────────────────────────────
function PaidStamp({ label }: { label: string }) {
  return (
    <div className="pointer-events-none fixed inset-0 z-[95] flex items-center justify-center" aria-hidden>
      <div className="flex flex-col items-center" style={{ animation: "fo-fx-fade 1.9s ease forwards" }}>
        <svg viewBox="0 0 96 96" className="h-24 w-24 drop-shadow-xl">
          <circle cx="48" cy="48" r="44" className="fill-emerald-500" style={{ transformOrigin: "48px 48px", animation: "fo-check-pop 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) both" }} />
          <path d="M28 50 L42 64 L69 35" fill="none" stroke="#fff" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round"
            pathLength={1} style={{ strokeDasharray: 1, strokeDashoffset: 1, animation: "fo-draw 0.45s cubic-bezier(0.65, 0, 0.35, 1) 0.25s forwards" }} />
        </svg>
        <div className="mt-3 max-w-[80vw] truncate rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-emerald-700 shadow-lg dark:bg-slate-800">
          Paid · {label}
        </div>
      </div>
    </div>
  );
}

// ── Confetti ────────────────────────────────────────────────────────────────────────────────────────────
const CONFETTI = ["#4f46e5", "#10b981", "#f59e0b", "#ec4899", "#06b6d4", "#8b5cf6"];
function Confetti() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = window.innerWidth, H = window.innerHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    ctx.scale(dpr, dpr);
    const N = W < 640 ? 70 : 120;
    const ps = Array.from({ length: N }, (_, i) => {
      const fromLeft = i % 2 === 0;
      const a = (fromLeft ? -60 : -120) * (Math.PI / 180) + (Math.random() - 0.5) * 0.9;
      const v = 9 + Math.random() * 8;
      return {
        x: fromLeft ? -10 : W + 10, y: H * 0.75,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        w: 6 + Math.random() * 6, h: 4 + Math.random() * 4,
        r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.35,
        c: CONFETTI[i % CONFETTI.length],
      };
    });
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = (now - t0) / 1000;
      ctx.clearRect(0, 0, W, H);
      ctx.globalAlpha = Math.max(0, Math.min(1, (2.4 - t) / 0.6));
      for (const p of ps) {
        p.vy += 0.32; p.vx *= 0.985; p.vy *= 0.985;
        p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate(p.r);
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2)));
        ctx.restore();
      }
      if (t < 2.4) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} className="pointer-events-none fixed inset-0 z-[96] h-full w-full" aria-hidden />;
}

// ── Wind-down "wrapped" card ────────────────────────────────────────────────────────────────────────────
function WrapCard({ stats, onClose }: { stats: WrapStats; onClose: () => void }) {
  const left = stats.income - stats.spent;
  const kept = stats.income > 0 ? Math.round((left / stats.income) * 100) : null;
  const [burst, setBurst] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setBurst(true), 900);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => { window.clearTimeout(t); window.removeEventListener("keydown", onKey); };
  }, [onClose]);
  const lines: { k: string; v: string; tone?: string }[] = [
    { k: "Came in", v: formatINR(Math.round(stats.income)) },
    { k: "Went out", v: formatINR(Math.round(stats.spent)) },
    { k: left >= 0 ? "Left over" : "Overspent", v: formatINR(Math.round(Math.abs(left))), tone: left >= 0 ? "text-emerald-300" : "text-rose-300" },
  ];
  return (
    <div className="fixed inset-0 z-[94] flex items-center justify-center bg-slate-950/60 p-4" onClick={onClose} style={{ animation: "fo-fade-in 0.25s ease" }} role="dialog" aria-modal="true" aria-label={`${stats.month} wrapped`}>
      {burst && <Confetti />}
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-sm overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 to-violet-600 p-6 text-[#fff] shadow-2xl"
        style={{ animation: "fo-wrap-in 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) both" }}
      >
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-[#fff]/10" aria-hidden />
        <div className="pointer-events-none absolute -bottom-12 -left-8 h-36 w-36 rounded-full bg-[#fff]/10" aria-hidden />
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#fff]/70" style={{ animation: "fo-rise 0.4s ease 0.15s backwards" }}>Month closed 🔒</p>
        <h2 className="mt-1 text-3xl font-black tracking-tight" style={{ animation: "fo-rise 0.4s ease 0.25s backwards" }}>{stats.month} wrapped</h2>
        <ul className="mt-5 space-y-2.5">
          {lines.map((l, i) => (
            <li key={l.k} className="flex items-baseline justify-between gap-3 border-b border-[#fff]/15 pb-2.5" style={{ animation: `fo-rise 0.45s cubic-bezier(0.22, 1, 0.36, 1) ${0.4 + i * 0.15}s backwards` }}>
              <span className="text-sm text-[#fff]/75">{l.k}</span>
              <span className={`text-xl font-extrabold tabular-nums ${l.tone ?? ""}`}>{l.v}</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 grid grid-cols-2 gap-2" style={{ animation: "fo-rise 0.45s ease 0.9s backwards" }}>
          {kept != null && (
            <div className="rounded-2xl bg-[#fff]/12 p-3">
              <div className="text-2xl font-black tabular-nums">{kept}%</div>
              <div className="text-[11px] text-[#fff]/70">of income kept</div>
            </div>
          )}
          {stats.budgets && stats.budgets.total > 0 && (
            <div className="rounded-2xl bg-[#fff]/12 p-3">
              <div className="text-2xl font-black tabular-nums">{stats.budgets.total - stats.budgets.over}/{stats.budgets.total}</div>
              <div className="text-[11px] text-[#fff]/70">budgets on track</div>
            </div>
          )}
          {stats.best && (
            <div className="col-span-2 rounded-2xl bg-[#fff]/12 p-3">
              <div className="text-[11px] text-[#fff]/70">Biggest spend</div>
              <div className="truncate text-base font-bold">{stats.best.name} · {formatINR(Math.round(stats.best.amount))}</div>
            </div>
          )}
        </div>
        <button type="button" onClick={onClose} className="mt-5 w-full rounded-xl bg-[#fff] py-2.5 text-sm font-bold text-indigo-700 shadow" style={{ animation: "fo-rise 0.45s ease 1.05s backwards" }}>
          Nice 🎉
        </button>
      </div>
    </div>
  );
}

// ── Helpers for pages ───────────────────────────────────────────────────────────────────────────────────

/** Fires confetti when `done` flips from false to true while you're looking (remembered per device in
 *  sessionStorage, so a page that's already done on arrival doesn't celebrate again). */
export function CelebrateWhen({ id, done }: { id: string; done: boolean }) {
  useEffect(() => {
    const k = `fo-done:${id}`;
    let before: string | null = null;
    try { before = sessionStorage.getItem(k); sessionStorage.setItem(k, done ? "1" : "0"); } catch { /* storage off */ }
    if (done && before === "0") fx({ kind: "confetti" });
  }, [id, done]);
  return null;
}

const useIsoLayout = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** A ✓ that draws itself in when it appears after the page has loaded (e.g. a step just ticked). On the
 *  first page load it's simply there. */
export function DrawCheck({ className = "" }: { className?: string }) {
  const [animate, setAnimate] = useState(false);
  useIsoLayout(() => { if (mountedLive() && !reducedMotion()) setAnimate(true); }, []);
  return (
    <svg viewBox="0 0 16 16" className={`inline-block h-3 w-3 ${className}`} aria-label="done">
      <path d="M3 8.5 L6.5 12 L13 4.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
        pathLength={1} style={animate ? { strokeDasharray: 1, strokeDashoffset: 1, animation: "fo-draw 0.4s cubic-bezier(0.65, 0, 0.35, 1) forwards" } : undefined} />
    </svg>
  );
}
