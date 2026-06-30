"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Toggle between single-month analysis (default) and a custom month range.
// Updates the URL; the server page reads ?mode=range&fy&fm&ty&tm.
export function AnalysisRangePicker({
  isRange,
  curYear,
  curMonth,
  from,
  to,
}: {
  isRange: boolean;
  curYear: number;
  curMonth: number;
  from: { y: number; m: number };
  to: { y: number; m: number };
}) {
  const router = useRouter();
  const [fy, setFy] = useState(from.y);
  const [fm, setFm] = useState(from.m);
  const [ty, setTy] = useState(to.y);
  const [tm, setTm] = useState(to.m);

  const now = new Date();
  const years: number[] = [];
  for (let y = now.getFullYear(); y >= 2000; y--) years.push(y);

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
        <select value={fm} onChange={(e) => setFm(Number(e.target.value))} className={sel}>
          {MONTHS.map((m, i) => (
            <option key={i} value={i + 1}>{m}</option>
          ))}
        </select>
        <select value={fy} onChange={(e) => setFy(Number(e.target.value))} className={sel}>
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <span>to</span>
        <select value={tm} onChange={(e) => setTm(Number(e.target.value))} className={sel}>
          {MONTHS.map((m, i) => (
            <option key={i} value={i + 1}>{m}</option>
          ))}
        </select>
        <select value={ty} onChange={(e) => setTy(Number(e.target.value))} className={sel}>
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <button onClick={apply} className="btn">Apply</button>
      </div>
    </div>
  );
}
