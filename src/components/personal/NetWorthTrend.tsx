"use client";

import { useState } from "react";
import { formatINR } from "@/lib/format";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Net worth over the last ≤12 months — one series, so no legend (the card title names it). A 2px line with a
// soft area, a recessive zero/baseline, the latest point marked, and a hover crosshair + tooltip per month.
export function NetWorthTrend({ points }: { points: { year: number; month: number; netWorth: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 2) {
    return <p className="text-[11px] text-slate-400">Your trend line starts next month — a point is saved for each month you use the app.</p>;
  }
  const W = 320, H = 72, PAD = 6;
  const vals = points.map((p) => p.netWorth);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const x = (i: number) => PAD + (i * (W - 2 * PAD)) / (points.length - 1);
  const y = (v: number) => PAD + (H - 2 * PAD) * (1 - (v - min) / span);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.netWorth).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)},${H - PAD} L${x(0).toFixed(1)},${H - PAD} Z`;
  const h = hover != null ? points[hover] : null;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-20 w-full" role="img" aria-label="Net worth over recent months"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const rel = ((e.clientX - r.left) / r.width) * W;
          setHover(Math.max(0, Math.min(points.length - 1, Math.round(((rel - PAD) / (W - 2 * PAD)) * (points.length - 1)))));
        }}
      >
        <line x1={PAD} x2={W - PAD} y1={H - PAD} y2={H - PAD} stroke="currentColor" className="text-slate-200" strokeWidth="1" />
        <path d={area} className="fill-emerald-500/10" />
        <path d={line} fill="none" className="stroke-emerald-600" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={PAD} y2={H - PAD} className="stroke-slate-300" strokeWidth="1" />}
        <circle cx={x(hover ?? points.length - 1)} cy={y(points[hover ?? points.length - 1].netWorth)} r="4" className="fill-emerald-600 stroke-white" strokeWidth="2" />
      </svg>
      <div className="mt-0.5 flex justify-between text-[10px] text-slate-400">
        <span>{MON[points[0].month - 1]} {String(points[0].year).slice(2)}</span>
        <span>{MON[points[points.length - 1].month - 1]} {String(points[points.length - 1].year).slice(2)}</span>
      </div>
      {h && (
        <div className="pointer-events-none absolute -top-7 rounded-md bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-white shadow" style={{ left: `clamp(0px, calc(${(x(hover!) / W) * 100}% - 48px), calc(100% - 110px))` }}>
          {MON[h.month - 1]} {h.year} · {formatINR(h.netWorth)}
        </div>
      )}
    </div>
  );
}
