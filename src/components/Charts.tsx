"use client";

import {
  Bar,
  BarChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

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
