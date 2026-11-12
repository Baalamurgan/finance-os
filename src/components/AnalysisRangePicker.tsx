"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { monthInYear, monthKey, yearsWithData } from "@/lib/monthPick";
import { startNavProgress } from "@/components/NavProgress";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const yOf = (k: number) => Math.floor(k / 12);
const mOf = (k: number) => (k % 12) + 1;

// Analysis period picker. Two modes:
//   • Month — ‹ › steps to the previous / next month that has a sheet, and a strip of every such month
//     to jump straight to one (the current one is scrolled into view).
//   • Range — quick picks (last 3 / 6 / 12 months with data, all) or a custom From → To.
// Only months with a sheet are offered. Updates the URL; the page reads ?y&m or ?mode=range&fy&fm&ty&tm.
export function AnalysisRangePicker({
  isRange,
  curYear,
  curMonth,
  from,
  to,
  dataMonths,
}: {
  isRange: boolean;
  curYear: number;
  curMonth: number;
  from: { y: number; m: number };
  to: { y: number; m: number };
  dataMonths: number[]; // y*12+(m-1) of months that have a sheet — only these can be picked
}) {
  const router = useRouter();
  const keys = [...new Set(dataMonths)].sort((a, b) => a - b);
  const allowed = new Set(keys);
  const cur = monthKey(curYear, curMonth);
  const strip = useRef<HTMLDivElement>(null);

  const go = (url: string) => { startNavProgress(); router.push(url); };
  const goMonth = (k: number) => go(`/analysis?y=${yOf(k)}&m=${mOf(k)}`);
  const goRange = (a: number, b: number) => go(`/analysis?mode=range&fy=${yOf(a)}&fm=${mOf(a)}&ty=${yOf(b)}&tm=${mOf(b)}`);

  // Month mode: neighbours with data
  const idx = keys.indexOf(cur);
  const prevK = idx > 0 ? keys[idx - 1] : idx === -1 ? [...keys].reverse().find((k) => k < cur) : undefined;
  const nextK = idx >= 0 && idx < keys.length - 1 ? keys[idx + 1] : idx === -1 ? keys.find((k) => k > cur) : undefined;

  useEffect(() => {
    const el = strip.current?.querySelector<HTMLElement>("[data-on]");
    el?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [cur, isRange]);

  // Range mode: custom From → To
  const [fy, setFy] = useState(from.y);
  const [fm, setFm] = useState(from.m);
  const [ty, setTy] = useState(to.y);
  const [tm, setTm] = useState(to.m);
  const years = yearsWithData(allowed, [fy, ty]);
  const fromKey = monthKey(fy, fm);
  const pickFromYear = (y: number) => {
    const m = monthInYear(allowed, y, fm);
    setFy(y);
    setFm(m);
    if (monthKey(ty, tm) < monthKey(y, m)) { setTy(y); setTm(m); }
  };
  const pickFromMonth = (m: number) => {
    setFm(m);
    if (monthKey(ty, tm) < monthKey(fy, m)) { setTy(fy); setTm(m); }
  };
  const pickToYear = (y: number) => {
    let m = monthInYear(allowed, y, tm);
    if (monthKey(y, m) < fromKey) m = fm; // same year as From → no earlier than From
    setTy(y);
    setTm(m);
  };

  // Quick ranges: the last N months that have data (ending at the latest), or everything.
  const last = keys[keys.length - 1];
  const quick = [3, 6, 12]
    .filter((n) => keys.length > n || n === 3)
    .map((n) => ({ label: `Last ${n}`, a: keys[Math.max(0, keys.length - n)], b: last }));
  quick.push({ label: "All", a: keys[0], b: last });
  const rangeA = monthKey(from.y, from.m), rangeB = monthKey(to.y, to.m);

  // Switching to Range starts from the 6 months with data up to the month in view.
  const toRange = () => {
    const upto = keys.filter((k) => k <= cur);
    const b = upto[upto.length - 1] ?? last;
    const a = upto[Math.max(0, upto.length - 6)] ?? keys[0];
    if (a != null && b != null) goRange(a, b);
  };

  const sel = "rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm shadow-sm";
  const chip = (on: boolean) =>
    `shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition ${on ? "bg-indigo-600 text-white shadow-sm shadow-indigo-600/30" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`;

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-3">
      <div className="flex items-center gap-2">
        <div className="inline-flex shrink-0 rounded-lg bg-slate-100 p-0.5 text-sm">
          <button type="button" onClick={() => isRange && goMonth(allowed.has(cur) ? cur : last)} className={`rounded-md px-3 py-1.5 font-medium ${!isRange ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500"}`}>
            Month
          </button>
          <button type="button" onClick={() => !isRange && toRange()} className={`rounded-md px-3 py-1.5 font-medium ${isRange ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500"}`}>
            Range
          </button>
        </div>

        {!isRange && (
          <div className="ml-auto flex items-center gap-1">
            <button type="button" onClick={() => prevK != null && goMonth(prevK)} disabled={prevK == null} aria-label="Previous month"
              className="grid h-8 w-8 place-items-center rounded-full text-lg text-slate-600 hover:bg-slate-100 disabled:opacity-30">‹</button>
            <span className="min-w-[5.5rem] text-center text-sm font-semibold tabular-nums text-slate-800">{MONTHS[curMonth - 1]} {curYear}</span>
            <button type="button" onClick={() => nextK != null && goMonth(nextK)} disabled={nextK == null} aria-label="Next month"
              className="grid h-8 w-8 place-items-center rounded-full text-lg text-slate-600 hover:bg-slate-100 disabled:opacity-30">›</button>
          </div>
        )}
      </div>

      {!isRange ? (
        // every month with a sheet, oldest → newest; the year shows on its first month
        <div ref={strip} className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {keys.map((k, i) => {
            const on = k === cur;
            const showYear = i === 0 || mOf(k) === 1;
            return (
              <button key={k} type="button" onClick={() => !on && goMonth(k)} data-on={on ? "" : undefined} aria-current={on ? "date" : undefined} className={chip(on)}>
                {MONTHS[mOf(k) - 1]}{showYear ? ` ’${String(yOf(k)).slice(2)}` : ""}
              </button>
            );
          })}
        </div>
      ) : (
        <>
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {quick.map((q) => (
              <button key={q.label} type="button" onClick={() => goRange(q.a, q.b)} className={chip(q.a === rangeA && q.b === rangeB)}>
                {q.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-sm text-slate-500">
            <span>From</span>
            <select value={fm} onChange={(e) => pickFromMonth(Number(e.target.value))} className={sel}>
              {MONTHS.map((m, i) => (
                <option key={i} value={i + 1} disabled={!allowed.has(monthKey(fy, i + 1))}>{m}</option>
              ))}
            </select>
            <select value={fy} onChange={(e) => pickFromYear(Number(e.target.value))} className={sel}>
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            <span>to</span>
            <select value={tm} onChange={(e) => setTm(Number(e.target.value))} className={sel}>
              {MONTHS.map((m, i) => (
                <option key={i} value={i + 1} disabled={!allowed.has(monthKey(ty, i + 1)) || monthKey(ty, i + 1) < fromKey}>{m}</option>
              ))}
            </select>
            <select value={ty} onChange={(e) => pickToYear(Number(e.target.value))} className={sel}>
              {years.map((y) => (
                <option key={y} value={y} disabled={y < fy}>{y}</option>
              ))}
            </select>
            <button type="button" onClick={() => goRange(monthKey(fy, fm), monthKey(ty, tm))} className="btn">Apply</button>
          </div>
        </>
      )}
    </div>
  );
}
