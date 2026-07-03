"use client";

import {
  Bar,
  BarChart,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

export function TrendChart({
  data,
}: {
  data: { label: string; income: number; expense: number; balance: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
        <YAxis tickFormatter={(v) => `₹${Math.round(Number(v) / 1000)}k`} tick={{ fontSize: 11 }} width={48} />
        <Tooltip formatter={(value) => inr(Number(value))} />
        <Legend />
        <Line type="monotone" dataKey="income" stroke="#16a34a" name="Income" strokeWidth={2} dot={{ r: 3 }} />
        <Line type="monotone" dataKey="expense" stroke="#dc2626" name="Expense" strokeWidth={2} dot={{ r: 3 }} />
        <Line type="monotone" dataKey="balance" stroke="#4f46e5" name="Balance" strokeWidth={2} dot={{ r: 3 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function CategoryBars({
  data,
}: {
  data: { name: string; actual: number; planned: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(220, data.length * 34)}>
      <BarChart data={data} layout="vertical" margin={{ left: 24, right: 24 }}>
        <XAxis type="number" tickFormatter={inr} fontSize={11} />
        <YAxis type="category" dataKey="name" width={120} fontSize={11} />
        <Tooltip formatter={(value) => inr(Number(value))} />
        <Legend />
        <Bar dataKey="planned" name="Budget" fill="#cbd5e1" radius={[0, 4, 4, 0]} />
        <Bar dataKey="actual" name="Spent" fill="#6366f1" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

const PIE_COLORS = [
  "#6366f1",
  "#22c55e",
  "#f59e0b",
  "#ef4444",
  "#06b6d4",
  "#a855f7",
  "#ec4899",
];

/** "Where did the income go" donut: one slice per section + a "Left" slice, with
 *  an amount/percent legend. Answers the "we earn so much, why so little left?". */
export function MoneyFlowDonut({
  segments,
  centerLabel,
  centerValue,
}: {
  segments: { name: string; value: number; color: string }[];
  centerLabel: string;
  centerValue: string;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row">
      <div className="relative h-[190px] w-[190px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={segments}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius="62%"
              outerRadius="90%"
              paddingAngle={1}
              stroke="none"
            >
              {segments.map((s, i) => (
                <Cell key={i} fill={s.color} />
              ))}
            </Pie>
            <Tooltip formatter={(value) => inr(Number(value))} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[11px] text-slate-400">{centerLabel}</span>
          <span className="text-lg font-bold text-slate-800">{centerValue}</span>
        </div>
      </div>
      <ul className="w-full flex-1 space-y-1.5">
        {segments.map((s) => (
          <li key={s.name} className="flex items-center gap-2 text-sm">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
            <span className="flex-1 truncate text-slate-600">{s.name}</span>
            <span className="tabular-nums font-medium text-slate-800">{inr(s.value)}</span>
            <span className="w-9 text-right text-xs text-slate-400">
              {Math.round((s.value / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SplitPie({
  data,
}: {
  data: { name: string; value: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="45%"
          outerRadius="70%"
        >
          {data.map((_, i) => (
            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip formatter={(value) => inr(Number(value))} />
        <Legend verticalAlign="bottom" height={28} iconSize={9} />
      </PieChart>
    </ResponsiveContainer>
  );
}
