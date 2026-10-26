"use client";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const STATUS_COLORS: Record<string, string> = {
  AVAILABLE: "#22c55e",
  RESERVED: "#f59e0b",
  BOOKED: "#3b82f6",
  SCHEDULED: "#6366f1",
  AIRED: "#14b8a6",
  UNAVAILABLE: "#94a3b8",
  CANCELLED: "#cbd5e1",
};

export function StackedBars({ data, keys, xKey, height = 260, colors }: { data: Record<string, unknown>[]; keys: string[]; xKey: string; height?: number; colors?: Record<string, string> }) {
  const palette = { ...STATUS_COLORS, ...colors };
  const fallback = ["#0f766e", "#f59e0b", "#6366f1", "#ef4444", "#14b8a6"];
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey={xKey} tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} width={48} />
        <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 }} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {keys.map((k, i) => (
          <Bar key={k} dataKey={k} stackId="a" fill={palette[k] ?? fallback[i % fallback.length]} radius={i === keys.length - 1 ? [3, 3, 0, 0] : 0} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function GroupedBars({ data, keys, xKey, height = 260 }: { data: Record<string, unknown>[]; keys: string[]; xKey: string; height?: number }) {
  const colors = ["#0f766e", "#f59e0b", "#6366f1"];
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey={xKey} tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} width={64} />
        <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 }} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {keys.map((k, i) => (
          <Bar key={k} dataKey={k} fill={colors[i % colors.length]} radius={[3, 3, 0, 0]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
