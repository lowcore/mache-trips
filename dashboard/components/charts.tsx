"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
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
  quiescent: "#a78bfa",
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

const legendStyle = { fontSize: 11, color: C.muted } as const;

export type ChartPoint = {
  ts: number; // epoch ms of trip_start, for time-scaled X axis
  label: string; // short "M/D HH:mm", shown in tooltips
  mi_per_kwh: number | null;
  soh_pct: number | null;
  hvb_temp_avg_f: number | null;
  soc_depth: number | null; // soc_start_pct - soc_end_pct, % of pack used on the trip
  v12_start: number | null;
  v12_end: number | null;
  v12_soc_start: number | null;
  v12_quiescent_ma: number | null;
};

// Day-aligned tick marks (local midnights) spanning the data range, so the
// time axis is labelled by calendar day rather than recharts' auto ticks.
function dayTicks(points: { ts: number }[]): number[] {
  if (!points.length) return [];
  const times = points.map((p) => p.ts);
  const start = new Date(Math.min(...times));
  start.setHours(0, 0, 0, 0);
  const max = Math.max(...times);
  const ticks: number[] = [];
  for (let d = start.getTime(); d <= max; d += 86_400_000) ticks.push(d);
  return ticks;
}

const mdFmt = (ms: number) => {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

// Tooltip header shows the full "M/D HH:mm" label instead of the raw epoch.
const tipLabel = (_: unknown, payload: ReadonlyArray<{ payload?: ChartPoint }>) =>
  payload?.[0]?.payload?.label ?? "";

// Shared props for a time-scaled X axis driven by the numeric `ts` field.
function timeXAxis(data: { ts: number }[]) {
  return {
    dataKey: "ts",
    type: "number" as const,
    scale: "time" as const,
    domain: ["dataMin", "dataMax"] as [string, string],
    ticks: dayTicks(data),
    tickFormatter: mdFmt,
    ...axisProps,
  };
}

const EFF_MA_WINDOW = 3; // trips per trailing moving-average point

// Trailing moving average of mi_per_kwh over the last EFF_MA_WINDOW trips
// (by position), skipping nulls, with partial windows at the series start.
function withEfficiencyMA(data: ChartPoint[]) {
  return data.map((p, i) => {
    const vals = data
      .slice(Math.max(0, i - EFF_MA_WINDOW + 1), i + 1)
      .map((q) => q.mi_per_kwh)
      .filter((v): v is number => v != null);
    return {
      ...p,
      mi_per_kwh_ma: vals.length
        ? Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2))
        : null,
    };
  });
}

export function EfficiencyTrend({ data, epa }: { data: ChartPoint[]; epa: number }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={withEfficiencyMA(data)} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
        <CartesianGrid stroke={C.grid} strokeDasharray="3 3" vertical={false} />
        {/* one equidistant slot per trip; bars need a band axis to size properly */}
        <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={24} />
        <YAxis {...axisProps} domain={[0, (max: number) => Math.ceil(max)]} unit="" />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(56,189,248,0.06)" }} />
        <Legend wrapperStyle={legendStyle} />
        <ReferenceLine
          y={epa}
          stroke={C.warn}
          strokeDasharray="6 4"
          label={{ value: `EPA ${epa}`, fill: C.warn, fontSize: 11, position: "insideBottomRight" }}
        />
        <Bar dataKey="mi_per_kwh" name="mi/kWh" fill={C.accent} fillOpacity={0.6} radius={[3, 3, 0, 0]} maxBarSize={26} />
        <Line
          type="monotone"
          dataKey="mi_per_kwh_ma"
          name={`${EFF_MA_WINDOW}-trip avg`}
          stroke={C.good}
          strokeWidth={2}
          dot={false}
          connectNulls
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function MonthlyBars({
  data,
  epa,
}: {
  data: { month: string; mi_per_kwh: number; logged_miles: number; odo_miles: number | null }[];
  epa: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -8 }}>
        <CartesianGrid stroke={C.grid} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="month" {...axisProps} />
        {/* left: miles */}
        <YAxis yAxisId="mi" {...axisProps} domain={[0, "auto"]} />
        {/* right: efficiency, mi/kWh */}
        <YAxis yAxisId="eff" orientation="right" {...axisProps} domain={[0, "auto"]} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(56,189,248,0.06)" }} />
        <Legend wrapperStyle={legendStyle} />
        <ReferenceLine yAxisId="eff" y={epa} stroke={C.warn} strokeDasharray="6 4" />
        <Bar yAxisId="mi" dataKey="odo_miles" name="Miles (odometer)" fill={C.accent} radius={[4, 4, 0, 0]} maxBarSize={40} />
        <Bar yAxisId="mi" dataKey="logged_miles" name="Miles (logged)" fill={C.muted} radius={[4, 4, 0, 0]} maxBarSize={40} />
        <Line
          yAxisId="eff"
          type="monotone"
          dataKey="mi_per_kwh"
          name="mi/kWh"
          stroke={C.good}
          strokeWidth={2}
          dot={{ r: 3, fill: C.good }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function SohTrend({ data }: { data: ChartPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -8 }}>
        <CartesianGrid stroke={C.grid} strokeDasharray="3 3" />
        <XAxis {...timeXAxis(data)} />
        {/* left: SoH %, on a tight domain so its slow drift is visible */}
        <YAxis
          yAxisId="soh"
          {...axisProps}
          domain={[(min: number) => Math.floor(Math.min(min, 95)) - 1, 100]}
        />
        {/* right: HVB average temperature, °F */}
        <YAxis
          yAxisId="temp"
          orientation="right"
          {...axisProps}
          domain={["auto", "auto"]}
          tickFormatter={(v: number) => `${Math.round(v)}°`}
        />
        {/* hidden, compressed so depth bars stay in the lower third behind the lines */}
        <YAxis yAxisId="depth" hide domain={[0, (max: number) => max * 3]} />
        <Tooltip contentStyle={tooltipStyle} labelFormatter={tipLabel} />
        <Legend wrapperStyle={legendStyle} />
        <Bar
          yAxisId="depth"
          dataKey="soc_depth"
          name="SoC used %"
          fill={C.accent}
          fillOpacity={0.4}
          maxBarSize={28}
        />
        <Line
          yAxisId="soh"
          type="stepAfter"
          dataKey="soh_pct"
          name="HVB SoH %"
          stroke={C.good}
          strokeWidth={2}
          dot={{ r: 3, fill: C.good }}
          connectNulls
        />
        <Line
          yAxisId="temp"
          type="monotone"
          dataKey="hvb_temp_avg_f"
          name="HVB °F"
          stroke={C.warn}
          strokeWidth={1.5}
          dot={false}
          connectNulls
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// Combined 12V battery chart: terminal voltage at trip start (left axis) plus
// quiescent/parasitic drain (right axis, mA) and 12V SoC (hidden axis, faint
// reference). Quiescent is the better leading health signal, so it gets a
// distinct colour and its own axis. V-at-end was dropped — during driving it's
// mostly the DC-DC converter's output, not battery state, and just added noise.
export function V12Chart({
  data,
  threshold,
  quiescentThreshold,
}: {
  data: ChartPoint[];
  threshold: number;
  quiescentThreshold: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
        <CartesianGrid stroke={C.grid} strokeDasharray="3 3" />
        <XAxis {...timeXAxis(data)} />
        <YAxis
          {...axisProps}
          yAxisId="v"
          domain={[(min: number) => Math.min(min - 0.5, threshold - 0.3), "auto"]}
          tickFormatter={(v: number) => v.toFixed(1)}
          label={{ value: "Volts", angle: -90, position: "insideLeft", fill: C.muted, fontSize: 11 }}
        />
        <YAxis
          {...axisProps}
          yAxisId="ma"
          orientation="right"
          stroke={C.quiescent}
          domain={[0, (max: number) => Math.max(max + 15, quiescentThreshold + 15)]}
          tickFormatter={(v: number) => v.toFixed(0)}
          label={{ value: "mA", angle: -90, position: "insideRight", fill: C.quiescent, fontSize: 11 }}
        />
        <YAxis {...axisProps} yAxisId="soc" orientation="right" domain={[0, 100]} hide />
        <Tooltip contentStyle={tooltipStyle} labelFormatter={tipLabel} />
        <Legend wrapperStyle={legendStyle} />
        <ReferenceLine
          yAxisId="v"
          y={threshold}
          stroke={C.bad}
          strokeDasharray="6 4"
          label={{ value: `${threshold} V`, fill: C.bad, fontSize: 11, position: "insideBottomRight" }}
        />
        <ReferenceLine
          yAxisId="ma"
          y={quiescentThreshold}
          stroke={C.warn}
          strokeDasharray="6 4"
          label={{ value: `${quiescentThreshold} mA`, fill: C.warn, fontSize: 11, position: "insideTopRight" }}
        />
        <Line
          yAxisId="soc"
          type="monotone"
          dataKey="v12_soc_start"
          name="12V SoC %"
          stroke={C.good}
          strokeWidth={1.5}
          strokeDasharray="4 3"
          dot={false}
          connectNulls
        />
        <Line
          yAxisId="ma"
          type="monotone"
          dataKey="v12_quiescent_ma"
          name="Quiescent drain (mA)"
          stroke={C.quiescent}
          strokeWidth={2}
          connectNulls
          dot={(props) => {
            const { cx, cy, value, index } = props as {
              cx?: number;
              cy?: number;
              value?: number;
              index?: number;
            };
            if (cx == null || cy == null || value == null) return <g key={`q${index}`} />;
            const high = value >= quiescentThreshold;
            return (
              <circle
                key={`q${index}`}
                cx={cx}
                cy={cy}
                r={high ? 5 : 3.5}
                fill={high ? C.warn : C.quiescent}
              />
            );
          }}
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
      </LineChart>
    </ResponsiveContainer>
  );
}
