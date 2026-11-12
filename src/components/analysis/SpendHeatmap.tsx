"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { startNavProgress } from "@/components/NavProgress";
import { formatINR } from "@/lib/format";

// Daily spending as a heatmap: darker = more spent that day. One month → a calendar (Mon–Sun rows of
// weeks, day numbers inside); a longer stretch → a contribution-style grid (a column per week, scrolled to
// the latest). Cells pop in one after another. Hover a day to read it (cleared when the mouse leaves the
// grid); click / tap a day with spends to open those spends on the Spends tab. Single hue, light → dark.

export type DayTotal = { date: string; amount: number; count: number; href?: string }; // date = YYYY-MM-DD (IST); href = that day on Spends

const TONE = {
  family: ["bg-slate-100", "bg-indigo-200 dark:bg-indigo-500/30", "bg-indigo-300 dark:bg-indigo-500/50", "bg-indigo-500 dark:bg-indigo-500/75", "bg-indigo-700 dark:bg-indigo-400"],
  personal: ["bg-slate-100", "bg-emerald-200 dark:bg-emerald-500/30", "bg-emerald-300 dark:bg-emerald-500/50", "bg-emerald-500 dark:bg-emerald-500/75", "bg-emerald-700 dark:bg-emerald-400"],
} as const;
const WD = ["M", "T", "W", "T", "F", "S", "S"];

const parse = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
const monIdx = (d: Date) => (d.getUTCDay() + 6) % 7; // Monday = 0
const nice = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

export function SpendHeatmap({ days, from, to, today, tone = "family" }: { days: DayTotal[]; from: string; to: string; today: string; tone?: keyof typeof TONE }) {
  const [sel, setSel] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const hrefOf = useMemo(() => new Map(days.filter((d) => d.href).map((d) => [d.date, d.href!])), [days]);
  const open = (date: string) => {
    const h = hrefOf.get(date);
    if (h) { startNavProgress(); router.push(h); }
    else setSel((s) => (s === date ? null : date)); // a day with nothing to open: just read it
  };
  const leave = (e: React.PointerEvent) => { if (e.pointerType === "mouse") setSel(null); };

  const data = useMemo(() => {
    const by = new Map(days.map((d) => [d.date, d]));
    const start = parse(from), end = parse(to);
    const last = parse(today) < end ? parse(today) : end; // nothing after today
    const list: { date: string; d: Date; amount: number; count: number; future: boolean }[] = [];
    for (let d = start; d <= end; d = addDays(d, 1)) {
      const k = iso(d);
      const v = by.get(k);
      list.push({ date: k, d, amount: Math.max(0, v?.amount ?? 0), count: v?.count ?? 0, future: d > last });
    }
    const past = list.filter((x) => !x.future);
    const max = Math.max(0, ...past.map((x) => x.amount));
    const level = (a: number) => (a <= 0 || max <= 0 ? 0 : Math.min(4, 1 + Math.floor(Math.sqrt(a / max) * 3.999)));
    const busiest = past.reduce<(typeof list)[number] | null>((b, x) => (x.amount > (b?.amount ?? 0) ? x : b), null);
    const noSpend = past.filter((x) => x.amount <= 0).length;
    const inWindow = past.reduce((s, x) => s + x.amount, 0);
    const outside = days.filter((x) => x.date < from || x.date > to).reduce((s, x) => s + x.amount, 0);
    return { list, level, busiest, noSpend, pastDays: past.length, inWindow, outside };
  }, [days, from, to, today]);

  const calendar = data.list.length <= 31;
  useEffect(() => { if (!calendar && scroller.current) scroller.current.scrollLeft = scroller.current.scrollWidth; }, [calendar]);

  const pal = TONE[tone];
  const selDay = sel ? data.list.find((x) => x.date === sel) : null;
  const cell = (x: (typeof data.list)[number], i: number, size: string, label?: boolean) => (
    <button
      key={x.date}
      type="button"
      disabled={x.future}
      onClick={() => open(x.date)}
      onPointerEnter={(e) => e.pointerType === "mouse" && !x.future && setSel(x.date)}
      title={x.future ? undefined : `${nice(x.d)} · ${x.amount > 0 ? formatINR(Math.round(x.amount)) : "no spends"}`}
      className={`fo-cell ${size} rounded-[4px] ${hrefOf.has(x.date) ? "cursor-pointer hover:ring-2 hover:ring-slate-400/60" : ""} ${x.future ? "bg-slate-50 opacity-50" : pal[data.level(x.amount)]} ${sel === x.date ? "ring-2 ring-slate-800 ring-offset-1 dark:ring-slate-300" : ""} ${label ? "grid place-items-center text-[10px] font-medium tabular-nums" : ""} ${label && data.level(x.amount) >= 3 ? "text-[#fff]" : "text-slate-500"}`}
      style={{ animationDelay: `${Math.min(i, 120) * 8}ms` }}
      aria-label={x.future ? `${nice(x.d)}, later` : `${nice(x.d)}, ${x.amount > 0 ? formatINR(Math.round(x.amount)) : "no spends"}`}
    >
      {label ? x.d.getUTCDate() : null}
    </button>
  );

  // Pad the first week so Monday stays the first row/column.
  const lead = monIdx(data.list[0]?.d ?? new Date());

  return (
    <div>
      {calendar ? (
        <div className="mx-auto max-w-sm" onPointerLeave={leave}>
          <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[10px] font-medium text-slate-400">
            {WD.map((d, i) => <span key={i}>{d}</span>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: lead }).map((_, i) => <span key={`p${i}`} />)}
            {data.list.map((x, i) => cell(x, i, "aspect-square w-full", true))}
          </div>
        </div>
      ) : (
        <div ref={scroller} className="overflow-x-auto pb-1">
          <div className="grid w-max grid-flow-col grid-rows-7 gap-[3px]" onPointerLeave={leave}>
            {Array.from({ length: lead }).map((_, i) => <span key={`p${i}`} className="h-3 w-3" />)}
            {data.list.map((x, i) => cell(x, i, "h-3 w-3"))}
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
        <span className="min-h-[1rem]" aria-live="polite">
          {selDay ? (
            <><b className="text-slate-700">{nice(selDay.d)}</b> · {selDay.amount > 0 ? `${formatINR(Math.round(selDay.amount))} · ${selDay.count} spend${selDay.count === 1 ? "" : "s"}` : "no spends"}</>
          ) : data.busiest ? (
            <>Busiest: <b className="text-slate-700">{nice(data.busiest.d)}</b> · {formatINR(Math.round(data.busiest.amount))} · <b className="text-slate-700">{data.noSpend}</b> no-spend day{data.noSpend === 1 ? "" : "s"}</>
          ) : (
            "No spends logged"
          )}
        </span>
        <span className="flex items-center gap-1 text-[10px] text-slate-400">
          Less {pal.map((c, i) => <span key={i} className={`h-2.5 w-2.5 rounded-[3px] ${c}`} />)} More
        </span>
      </div>
      {data.outside > 0.5 && (
        <p className="mt-1 text-[10px] text-slate-400">+ {formatINR(Math.round(data.outside))} logged on days outside this stretch</p>
      )}
    </div>
  );
}
