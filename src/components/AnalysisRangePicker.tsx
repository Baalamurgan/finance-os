"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { monthInYear, monthKey, yearsWithData } from "@/lib/monthPick";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Toggle between single-month analysis (default) and a custom month range.
// Updates the URL; the server page reads ?mode=range&fy&fm&ty&tm.
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
  const [fy, setFy] = useState(from.y);
  const [fm, setFm] = useState(from.m);
  const [ty, setTy] = useState(to.y);
  const [tm, setTm] = useState(to.m);

  // Only months with a sheet are offered; years with none are left out. "To" can't be before "From".
  const allowed = new Set(dataMonths);
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

  const apply = () => router.push(`/analysis?mode=range&fy=${fy}&fm=${fm}&ty=${ty}&tm=${tm}`);
  const single = () => router.push(`/analysis?y=${curYear}&m=${curMonth}`);

  const sel = "rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm shadow-sm";

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3">
      <div className="inline-flex overflow-hidden rounded-lg border border-slate-300 text-sm">
        <button
          onClick={single}
          className={`px-3 py-1.5 font-medium ${!isRange ? "bg-indigo-600 text-white" : "text-slate-600"}`}
        >
          This month
        </button>
        <button
          onClick={apply}
          className={`px-3 py-1.5 font-medium ${isRange ? "bg-indigo-600 text-white" : "text-slate-600"}`}
        >
          Range
        </button>
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
        <button onClick={apply} className="btn">Apply</button>
      </div>
    </div>
  );
}
