"use client";

import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface TrendSeries {
  key: string;
  name: string;
  color: string;
  points: { at: string; y: number; lo: number; hi: number }[];
}

/** Nightly pass rate per agent with the Wilson 95 % band shaded (SPEC §2.4: never a bare number). */
export function TrendChart({ series, height = 260, yLabel = "pass rate" }: { series: TrendSeries[]; height?: number; yLabel?: string }) {
  const days = new Map<string, Record<string, number | [number, number] | string>>();
  for (const s of series) {
    for (const p of s.points) {
      const day = p.at.slice(0, 10);
      const row = days.get(day) ?? { day };
      row[s.key] = p.y;
      row[`${s.key}_band`] = [p.lo, p.hi];
      days.set(day, row);
    }
  }
  const data = [...days.values()].sort((a, b) => String(a.day).localeCompare(String(b.day)));
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <defs>
            {series.map((s) => (
              <linearGradient key={s.key} id={`band-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={s.color} stopOpacity={0.22} />
                <stop offset="1" stopColor={s.color} stopOpacity={0.06} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid vertical={false} strokeDasharray="2 6" />
          <XAxis dataKey="day" tickLine={false} axisLine={false} tickFormatter={(d: string) => d.slice(5)} minTickGap={28} />
          <YAxis
            domain={[0, 1]}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
            width={52}
            aria-label={yLabel}
          />
          <Tooltip
            cursor={{ stroke: "var(--line-strong)" }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const row = payload[0].payload as Record<string, unknown>;
              return (
                <div className="rounded-xl border border-line-strong bg-surface-2/95 px-3 py-2 shadow-xl backdrop-blur">
                  <p className="kicker mb-1">{String(label)}</p>
                  {series.map((s) =>
                    typeof row[s.key] === "number" ? (
                      <p key={s.key} className="flex items-center gap-2 font-mono text-[0.7rem] text-ink-2">
                        <span className="size-2 rounded-full" style={{ background: s.color }} />
                        {s.name} {Math.round((row[s.key] as number) * 100)}%
                        <span className="text-muted">
                          ({Math.round(((row[`${s.key}_band`] as number[])[0] ?? 0) * 100)}–{Math.round(((row[`${s.key}_band`] as number[])[1] ?? 0) * 100)}%)
                        </span>
                      </p>
                    ) : null,
                  )}
                </div>
              );
            }}
          />
          {series.map((s) => (
            <Area key={`${s.key}-band`} dataKey={`${s.key}_band`} stroke="none" fill={`url(#band-${s.key})`} isAnimationActive animationDuration={900} connectNulls />
          ))}
          {series.map((s) => (
            <Line
              key={s.key}
              dataKey={s.key}
              name={s.name}
              stroke={s.color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0, fill: s.color }}
              isAnimationActive
              animationDuration={1100}
              connectNulls
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
