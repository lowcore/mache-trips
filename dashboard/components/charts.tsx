"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const C = {
  accent: "#38bdf8",
  good: "#34d399",
  warn: "#fbbf24",
  bad: "#f87171",
  grid: "#1d2a38",
  muted: "#8aa0b6",
  tooltipBg: "#15202d",
};

const tooltipStyle = {
  backgroundColor: C.tooltipBg,
  border: `1px solid ${C.grid}`,
  borderRadius: 8,
  fontSize: 12,
  color: "#e2e8f0",
};

const axisProps = {
  stroke: C.muted,
  fontSize: 11,
  tickLine: false,
} as const;

export type ChartPoint = {
  label: string; // short "M/D HH:mm"
  mi_per_kwh: number | null;
  soh_pct: number | null;
  v12_start: number | null;
  v12_end: number | null;
  v12_soc_start: number | null;
};

export function EfficiencyTrend({ data, epa }: { data: ChartPoint[]; epa: number }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
        <CartesianGrid stroke={C.grid} strokeDasharray="3 3" />
        <XAxis dataKey="label" {...axisProps} />
        <YAxis {...axisProps} domain={["auto", "auto"]} unit="" />
        <Tooltip contentStyle={tooltipStyle} />
        <ReferenceLine
          y={epa}
          stroke={C.warn}
          strokeDasharray="6 4"
          label={{ value: `EPA ${epa}`, fill: C.warn, fontSize: 11, position: "insideBottomRight" }}
        />
        <Line
          type="monotone"
          dataKey="mi_per_kwh"
          name="mi/kWh"
          stroke={C.accent}
          strokeWidth={2}
          dot={{ r: 3, fill: C.accent }}
          connectNulls
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function MonthlyBars({
  data,
  epa,
}: {
  data: { month: string; mi_per_kwh: number; trips: number }[];
  epa: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
        <CartesianGrid stroke={C.grid} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="month" {...axisProps} />
        <YAxis {...axisProps} domain={[0, "auto"]} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(56,189,248,0.06)" }} />
        <ReferenceLine y={epa} stroke={C.warn} strokeDasharray="6 4" />
        <Bar dataKey="mi_per_kwh" name="mi/kWh" radius={[6, 6, 0, 0]} maxBarSize={48}>
          {data.map((d) => (
            <Cell key={d.month} fill={d.mi_per_kwh >= epa ? C.good : C.bad} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function SohTrend({ data }: { data: ChartPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
        <CartesianGrid stroke={C.grid} strokeDasharray="3 3" />
        <XAxis dataKey="label" {...axisProps} />
        <YAxis {...axisProps} domain={[(min: number) => Math.floor(Math.min(min, 95)) - 1, 100]} />
        <Tooltip contentStyle={tooltipStyle} />
        <Line
          type="stepAfter"
          dataKey="soh_pct"
          name="HVB SoH %"
          stroke={C.good}
          strokeWidth={2}
          dot={{ r: 3, fill: C.good }}
          connectNulls
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function V12Chart({ data, threshold }: { data: ChartPoint[]; threshold: number }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
        <CartesianGrid stroke={C.grid} strokeDasharray="3 3" />
        <XAxis dataKey="label" {...axisProps} />
        <YAxis
          {...axisProps}
          yAxisId="v"
          domain={[(min: number) => Math.min(min - 0.5, threshold - 0.3), "auto"]}
          tickFormatter={(v: number) => v.toFixed(1)}
        />
        <YAxis {...axisProps} yAxisId="soc" orientation="right" domain={[0, 100]} hide />
        <Tooltip contentStyle={tooltipStyle} />
        <ReferenceLine
          yAxisId="v"
          y={threshold}
          stroke={C.bad}
          strokeDasharray="6 4"
          label={{ value: `${threshold} V`, fill: C.bad, fontSize: 11, position: "insideBottomRight" }}
        />
        <Line
          yAxisId="soc"
          type="monotone"
          dataKey="v12_soc_start"
          name="12V SoC %"
          stroke={C.muted}
          strokeWidth={1.5}
          strokeDasharray="4 3"
          dot={false}
          connectNulls
        />
        <Line
          yAxisId="v"
          type="monotone"
          dataKey="v12_start"
          name="V at start"
          stroke={C.accent}
          strokeWidth={2}
          connectNulls
          dot={(props) => {
            const { cx, cy, value, index } = props as {
              cx?: number;
              cy?: number;
              value?: number;
              index?: number;
            };
            if (cx == null || cy == null || value == null) return <g key={`s${index}`} />;
            const low = value < threshold;
            return (
              <circle
                key={`s${index}`}
                cx={cx}
                cy={cy}
                r={low ? 5 : 3}
                fill={low ? C.bad : C.accent}
              />
            );
          }}
        />
        <Line
          yAxisId="v"
          type="monotone"
          dataKey="v12_end"
          name="V at end"
          stroke={C.good}
          strokeWidth={1.5}
          connectNulls
          dot={(props) => {
            const { cx, cy, value, index } = props as {
              cx?: number;
              cy?: number;
              value?: number;
              index?: number;
            };
            if (cx == null || cy == null || value == null) return <g key={`e${index}`} />;
            const low = value < threshold;
            return (
              <circle
                key={`e${index}`}
                cx={cx}
                cy={cy}
                r={low ? 5 : 3}
                fill={low ? C.bad : C.good}
              />
            );
          }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
