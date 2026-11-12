"use client";

import { useId, useState } from "react";
import { pctLabel } from "@/lib/format";

// The money donut (Sheet, Spends, Wind-down, personal pages) drawn as plain SVG — no chart library, so
// those pages no longer download recharts (~110 KB gzipped) just for a ring. Same look as before: ring
// with thin gaps, label + figure in the middle, legend with share bars. Hover / tap a slice or a legend
// row to read it in the middle (replaces the old tooltip). The ring sweeps in once on arrival.

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const R = 38; // ring radius in a 100×100 box (outer 45, inner 31 — the old 90% / 62%)
const W = 14;

export function MoneyFlowDonut({
  segments,
  centerLabel,
  centerValue,
}: {
  segments: { name: string; value: number; color: string }[];
  centerLabel: string;
  centerValue: string;
}) {
  const [on, setOn] = useState<number | null>(null);
  const maskId = `dm${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0) || 1;
  const shown = segments.filter((s) => s.value > 0).length;
  const gap = shown > 1 ? 100 / 360 : 0; // 1° between slices
  const share = segments.map((s) => (Math.max(0, s.value) / total) * 100);
  const arcs = share.map((len, i) => ({ i, start: share.slice(0, i).reduce((a, b) => a + b, 0), len: Math.max(0, len - gap) }));
  const act = on != null ? segments[on] : null;
  const toggle = (i: number) => setOn((o) => (o === i ? null : i));
  const hover = (i: number | null) => (e: React.PointerEvent) => { if (e.pointerType === "mouse") setOn(i); };

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row">
      <div className="relative h-[190px] w-[190px] shrink-0">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" role="img"
          aria-label={`${centerLabel} ${centerValue}: ${segments.map((s) => `${s.name} ${inr(s.value)}`).join(", ")}`}>
          <mask id={maskId}>
            <circle cx="50" cy="50" r={R} fill="none" stroke="#fff" strokeWidth={W + 8} pathLength={1} className="fo-donut-sweep" />
          </mask>
          <g mask={`url(#${maskId})`}>
            {arcs.map((a) => a.len > 0 && (
              <circle key={a.i} cx="50" cy="50" r={R} fill="none" stroke={segments[a.i].color} pathLength={100}
                strokeWidth={on === a.i ? W + 3 : W} strokeDasharray={`${a.len} ${100 - a.len}`} strokeDashoffset={-a.start}
                className="cursor-pointer" style={{ opacity: on == null || on === a.i ? 1 : 0.35, transition: "opacity 0.2s, stroke-width 0.2s" }}
                onClick={() => toggle(a.i)} onPointerEnter={hover(a.i)} onPointerLeave={hover(null)} />
            ))}
          </g>
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-8 text-center" aria-live="polite">
          <span className="max-w-full truncate text-[11px] text-slate-400">{act ? act.name : centerLabel}</span>
          <span className="text-lg font-bold text-slate-800">{act ? inr(act.value) : centerValue}</span>
        </div>
      </div>
      <ul className="w-full flex-1 space-y-1.5">
        {segments.map((s, i) => (
          <li key={s.name} className="cursor-pointer text-sm" onClick={() => toggle(i)} onPointerEnter={hover(i)} onPointerLeave={hover(null)}>
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
              <span className={`flex-1 truncate ${on === i ? "font-semibold text-slate-800" : "text-slate-600"}`}>{s.name}</span>
              <span className="tabular-nums font-medium text-slate-800">{inr(s.value)}</span>
              <span className="w-9 text-right text-xs text-slate-400">{pctLabel((s.value / total) * 100)}</span>
            </div>
            {/* share of the whole, as a slim bar that fills in on arrival */}
            <div className="ml-[18px] mr-11 mt-0.5 h-1 overflow-hidden rounded-full bg-slate-100" aria-hidden>
              <div className="fo-bar h-full rounded-full" style={{ width: `${Math.max(1.5, (s.value / total) * 100)}%`, background: s.color, animationDelay: `${120 + i * 50}ms` }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
