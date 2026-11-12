"use client";

import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

// Cash flow: income vs spent per month as paired bars on one rupee scale. The month in focus stays solid,
// the rest step back; hover (or tap) a month for income / spent / left. Bars grow up on arrival.
export function CashFlowChart({
  data,
  focus,
}: {
  data: { label: string; income: number; expense: number; balance: number }[];
  focus?: string | null; // label of the month to emphasise
}) {
  const dim = (label: string) => (focus && label !== focus ? 0.4 : 1);
  return (
    <div className="[&_.recharts-cartesian-axis-tick-value]:fill-slate-400 [&_.recharts-cartesian-grid_line]:stroke-slate-100">
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barGap={2} barCategoryGap="22%">
          <CartesianGrid vertical={false} strokeDasharray="3 4" />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" tickFormatter={shortMonth} />
          <YAxis tickFormatter={compactINR} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={46} />
          <Tooltip cursor={{ fill: "rgba(148, 163, 184, 0.12)" }} content={<FlowTip />} />
          <Bar dataKey="income" name="Income" fill="#16a34a" radius={[4, 4, 0, 0]} maxBarSize={18} animationDuration={700} animationEasing="ease-out">
            {data.map((d) => <Cell key={d.label} fillOpacity={dim(d.label)} />)}
          </Bar>
          <Bar dataKey="expense" name="Spent" fill="#dc2626" radius={[4, 4, 0, 0]} maxBarSize={18} animationDuration={700} animationBegin={120} animationEasing="ease-out">
            {data.map((d) => <Cell key={d.label} fillOpacity={dim(d.label)} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// "NOV 2026" / "Nov 2026" → "Nov 26"; anything else is shown as is.
function shortMonth(label: string) {
  const m = String(label).match(/^([A-Za-z]{3})[A-Za-z]*\s+(\d{4})$/);
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${m[2].slice(2)}` : String(label);
}

function compactINR(v: number) {
  const n = Math.abs(Number(v));
  const sign = Number(v) < 0 ? "-" : "";
  if (n >= 1e7) return `${sign}₹${+(n / 1e7).toFixed(1)}Cr`;
  if (n >= 1e5) return `${sign}₹${+(n / 1e5).toFixed(1)}L`;
  if (n >= 1e3) return `${sign}₹${Math.round(n / 1e3)}k`;
  return `${sign}₹${n}`;
}

function FlowTip({ active, payload, label }: { active?: boolean; payload?: { payload: { income: number; expense: number; balance: number } }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="min-w-[150px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg shadow-slate-900/10">
      <div className="mb-1 font-semibold text-slate-700">{label}</div>
      <Row dot="#16a34a" k="Income" v={inr(Math.round(d.income))} />
      <Row dot="#dc2626" k="Spent" v={inr(Math.round(d.expense))} />
      <div className="mt-1 border-t border-slate-100 pt-1">
        <Row k="Left" v={`${Math.round(d.balance) < 0 ? "-" : ""}${inr(Math.abs(Math.round(d.balance)))}`} bold tone={d.balance < 0 ? "text-red-600" : "text-slate-800"} />
      </div>
    </div>
  );
}

function Row({ dot, k, v, bold, tone = "text-slate-700" }: { dot?: string; k: string; v: string; bold?: boolean; tone?: string }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      {dot ? <span className="h-2 w-2 rounded-full" style={{ background: dot }} /> : <span className="w-2" />}
      <span className="flex-1 text-slate-500">{k}</span>
      <span className={`tabular-nums ${bold ? "font-semibold" : ""} ${tone}`}>{v}</span>
    </div>
  );
}

// Stacked monthly spend by 50/30/20 bucket (need / want / invest).
export function BucketTrend({
  data,
}: {
  data: { label: string; need: number; want: number; invest: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
        <YAxis tickFormatter={(v) => `₹${Math.round(Number(v) / 1000)}k`} tick={{ fontSize: 10 }} width={44} />
        <Tooltip formatter={(value) => inr(Number(value))} />
        <Legend iconSize={9} />
        <Bar dataKey="need" stackId="a" fill="#10b981" name="Need" radius={[0, 0, 0, 0]} />
        <Bar dataKey="want" stackId="a" fill="#8b5cf6" name="Want" />
        <Bar dataKey="invest" stackId="a" fill="#f59e0b" name="Invest" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// Single-series monthly spend bars (credit-card dashboard).
export function SpendBars({
  data,
  color = "#6366f1",
}: {
  data: { label: string; total: number }[];
  color?: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <XAxis dataKey="label" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
        <YAxis tickFormatter={(v) => `₹${Math.round(Number(v) / 1000)}k`} tick={{ fontSize: 10 }} width={44} />
        <Tooltip formatter={(value) => inr(Number(value))} />
        <Bar dataKey="total" fill={color} radius={[3, 3, 0, 0]} name="Spent" />
      </BarChart>
    </ResponsiveContainer>
  );
}

// Per-category "budgeted vs spent" across a range, with a category picker. The gap
// between budget and spent is what stayed unspent (→ saved / Piggy) that month.
export function CategoryRangeChart({
  months,
  categories,
}: {
  months: string[];
  categories: {
    id: number;
    name: string;
    planned: number[];
    spent: number[];
    totalPlanned: number;
    totalSpent: number;
  }[];
}) {
  const [sel, setSel] = useState<number>(categories[0]?.id ?? 0);
  if (categories.length === 0) {
    return <p className="text-sm text-slate-400">No budgeted categories in this range.</p>;
  }
  const cat = categories.find((c) => c.id === sel) ?? categories[0];
  const data = months.map((label, i) => ({
    label,
    planned: cat.planned[i] ?? 0,
    spent: cat.spent[i] ?? 0,
  }));
  const saved = cat.totalPlanned - cat.totalSpent;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <select
          value={cat.id}
          onChange={(e) => setSel(Number(e.target.value))}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700"
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <p className="text-xs text-slate-500">
          Budgeted <b className="text-slate-700">{inr(cat.totalPlanned)}</b> · spent{" "}
          <b className="text-slate-700">{inr(cat.totalSpent)}</b> ·{" "}
          <span className={saved >= 0 ? "font-semibold text-green-600" : "font-semibold text-red-600"}>
            {saved >= 0 ? `${inr(saved)} unspent → Piggy` : `${inr(-saved)} over`}
          </span>
        </p>
      </div>
      <div className="mb-2 flex items-center gap-3 text-[11px] text-slate-500">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-slate-300" />Budgeted</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-indigo-500" />Spent</span>
      </div>
      <div className="[&_.recharts-cartesian-axis-tick-value]:fill-slate-400 [&_.recharts-cartesian-grid_line]:stroke-slate-100">
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barGap={2} barCategoryGap="22%">
          <CartesianGrid vertical={false} strokeDasharray="3 4" />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" tickFormatter={shortMonth} />
          <YAxis tickFormatter={compactINR} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={46} />
          <Tooltip cursor={{ fill: "rgba(148, 163, 184, 0.12)" }} formatter={(value) => inr(Math.round(Number(value)))} contentStyle={{ borderRadius: 12, fontSize: 12, background: "var(--color-white)", borderColor: "var(--color-slate-200)" }} labelStyle={{ color: "var(--color-slate-700)", fontWeight: 600 }} />
          <Bar dataKey="planned" name="Budgeted" fill="#cbd5e1" radius={[4, 4, 0, 0]} maxBarSize={18} animationDuration={700} />
          <Bar dataKey="spent" name="Spent" fill="#6366f1" radius={[4, 4, 0, 0]} maxBarSize={18} animationDuration={700} animationBegin={120} />
        </BarChart>
      </ResponsiveContainer>
      </div>
    </div>
  );
}
