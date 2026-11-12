"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatINR } from "@/lib/format";

// "Where the money flowed": a 3-column flow chart (sources → a middle step → where it ended up). Each band's
// thickness is its rupees. The bands draw themselves in from left to right, then a light shimmer runs
// along them a few times. Tap / hover a box to light up its flows and read its figure underneath.
// Hand-rolled SVG (no chart library): labels sit outside the flow so it stays readable on a phone.

export type FlowNode = { id: string; label: string; value: number; col: 0 | 1 | 2; color: string };
export type FlowLink = { from: string; to: string; value: number };

const NODE_W = 10;
const MIN_SLOT = 24; // vertical room per box, so labels never collide
const GAP = 6;

const compact = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e7) return `₹${(n / 1e7).toFixed(a >= 1e8 ? 0 : 1)}Cr`;
  if (a >= 1e5) return `₹${(n / 1e5).toFixed(a >= 1e6 ? 0 : 1)}L`;
  if (a >= 1e3) return `₹${Math.round(n / 1e3)}k`;
  return `₹${Math.round(n)}`;
};
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function MoneyFlow({ nodes, links, total, totalLabel }: { nodes: FlowNode[]; links: FlowLink[]; total: number; totalLabel: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    setW(Math.round(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);

  const layout = useMemo(() => {
    if (w < 200) return null;
    const narrow = w < 480;
    const labelL = narrow ? 78 : 120, labelR = narrow ? 96 : 150;
    const xs = [labelL, Math.round(labelL + (w - labelL - labelR - NODE_W) / 2), w - labelR - NODE_W];
    const cols = [0, 1, 2].map((c) => nodes.filter((n) => n.col === c));
    const maxTotal = Math.max(1, ...cols.map((cs) => cs.reduce((s, n) => s + n.value, 0)));
    const k = (narrow ? 220 : 260) / maxTotal; // px per rupee
    const pos = new Map<string, { x: number; y: number; h: number; inY: number; outY: number }>();
    let H = 0;
    const colH = cols.map((cs) => cs.reduce((s, n) => s + Math.max(n.value * k, MIN_SLOT), 0) + GAP * Math.max(0, cs.length - 1));
    const maxH = Math.max(...colH);
    cols.forEach((cs, c) => {
      let y = (maxH - colH[c]) / 2;
      for (const n of cs) {
        const h = Math.max(1.5, n.value * k);
        const slot = Math.max(h, MIN_SLOT);
        const top = y + (slot - h) / 2;
        pos.set(n.id, { x: xs[c], y: top, h, inY: top, outY: top });
        y += slot + GAP;
      }
      H = Math.max(H, y);
    });
    const bands = links
      .filter((l) => l.value > 0 && pos.has(l.from) && pos.has(l.to))
      .map((l, i) => {
        const a = pos.get(l.from)!, b = pos.get(l.to)!;
        const t = Math.max(1, l.value * k);
        const y1 = a.outY + t / 2, y2 = b.inY + t / 2;
        a.outY += t; b.inY += t;
        const x1 = a.x + NODE_W, x2 = b.x, mx = (x1 + x2) / 2;
        return { ...l, i, t, d: `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`, col: nodes.find((n) => n.id === l.from)!.col };
      });
    return { pos, bands, H: Math.ceil(H), narrow };
  }, [w, nodes, links]);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const lit = (l: FlowLink) => active == null || l.from === active || l.to === active;
  const act = active ? byId.get(active) : null;

  return (
    <div ref={box} className="w-full">
      {layout && (
        <svg width={w} height={layout.H} className="block overflow-visible" role="img" aria-label={`Money flow: ${nodes.map((n) => `${n.label} ${formatINR(Math.round(n.value))}`).join(", ")}`}>
          {layout.bands.map((b) => {
            const color = byId.get(b.to)?.color ?? "#94a3b8"; // a band wears the colour of where it goes
            return (
              <g key={`${b.from}>${b.to}`} style={{ opacity: lit(b) ? 1 : 0.12, transition: "opacity 0.25s" }}>
                <path d={b.d} fill="none" stroke={color} strokeOpacity={0.28} strokeWidth={b.t} pathLength={1}
                  style={{ strokeDasharray: 1, strokeDashoffset: 1, animation: `fo-draw 0.9s cubic-bezier(0.65, 0, 0.35, 1) ${0.15 + b.col * 0.55 + Math.min(b.i, 10) * 0.03}s forwards` }}>
                  <title>{`${byId.get(b.from)?.label} → ${byId.get(b.to)?.label}: ${formatINR(Math.round(b.value))}`}</title>
                </path>
                {b.t >= 6 && (
                  // a thin line of light running along the band's middle (a few passes, then still)
                  <path d={b.d} fill="none" stroke={color} strokeOpacity={0.55} strokeWidth={1.5} strokeLinecap="butt"
                    className="fo-flow pointer-events-none" style={{ strokeDasharray: "14 26", strokeDashoffset: 0, animationDelay: `${1.4 + b.col * 0.3}s` }} />
                )}
              </g>
            );
          })}
          {nodes.map((n, i) => {
            const p = layout.pos.get(n.id);
            if (!p) return null;
            const on = active == null || active === n.id || links.some((l) => (l.from === active && l.to === n.id) || (l.to === active && l.from === n.id));
            const cy = p.y + p.h / 2;
            const left = n.col === 0;
            const tx = left ? p.x - 6 : p.x + NODE_W + 6;
            const max = layout.narrow ? (n.col === 1 ? 12 : 13) : 20;
            return (
              <g key={n.id} onClick={() => setActive((a) => (a === n.id ? null : n.id))}
                onPointerEnter={(e) => e.pointerType === "mouse" && setActive(n.id)} onPointerLeave={(e) => e.pointerType === "mouse" && setActive(null)}
                className="cursor-pointer" style={{ opacity: on ? 1 : 0.35, transition: "opacity 0.25s" }}>
                <rect x={p.x - 4} y={p.y - 6} width={NODE_W + 8} height={p.h + 12} fill="transparent" />
                <rect x={p.x} y={p.y} width={NODE_W} height={p.h} rx={3} fill={n.color}
                  style={{ transformBox: "fill-box", transformOrigin: "center", animation: `fo-cell-in 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) ${n.col * 0.5 + i * 0.02}s backwards` }} />
                <text x={tx} y={cy - 2} textAnchor={left ? "end" : "start"} className="fill-slate-700 text-[11px] font-semibold"
                  style={{ paintOrder: "stroke", stroke: "var(--color-white)", strokeWidth: n.col === 1 ? 3 : 0, animation: `fo-fade-in 0.4s ease ${0.3 + n.col * 0.55}s backwards` }}>
                  {clip(n.label, max)}
                </text>
                <text x={tx} y={cy + 10} textAnchor={left ? "end" : "start"} className="fill-slate-400 text-[10px] tabular-nums"
                  style={{ paintOrder: "stroke", stroke: "var(--color-white)", strokeWidth: n.col === 1 ? 3 : 0, animation: `fo-fade-in 0.4s ease ${0.3 + n.col * 0.55}s backwards` }}>
                  {compact(n.value)}
                </text>
              </g>
            );
          })}
        </svg>
      )}
      <p className="mt-2 min-h-[1.25rem] text-center text-xs text-slate-500" aria-live="polite">
        {act ? (
          <><b className="text-slate-700">{act.label}</b> · {formatINR(Math.round(act.value))}{total > 0 ? ` · ${Math.round((act.value / total) * 100)}% of ${totalLabel}` : ""}</>
        ) : (
          <span className="text-slate-400">Tap a box to follow its money</span>
        )}
      </p>
    </div>
  );
}
