"use client";

import { useMemo, useState } from "react";
import { TIRE_HIGH_PSI, TIRE_LOW_PSI, type Trip } from "@/lib/types";

type Col = {
  key: string;
  label: React.ReactNode;
  fmt?: (v: number) => string;
  cls?: (v: number) => string;
  // composite columns provide their own renderer and sort value
  render?: (t: Trip) => React.ReactNode;
  sortVal?: (t: Trip) => number | string | null;
};

function psiClass(v: number | null) {
  if (v == null) return "dim";
  if (v < TIRE_LOW_PSI) return "psi-low";
  if (v > TIRE_HIGH_PSI) return "psi-high";
  return undefined;
}

function TireCell({ t }: { t: Trip }) {
  const tires: [string, number | null][] = [
    ["LF", t.tire_lf_psi],
    ["RF", t.tire_rf_psi],
    ["LR", t.tire_lr_psi],
    ["RR", t.tire_rr_psi],
  ];
  if (tires.every(([, v]) => v == null)) return <span className="dim">—</span>;
  const tip = tires
    .map(([n, v]) => `${n} ${v != null ? Math.round(v) : "?"}`)
    .join("  ");
  return (
    <span title={`${tip}  (psi, trip avg)`} style={{ whiteSpace: "nowrap" }}>
      {tires.map(([n, v], i) => (
        <span key={n}>
          {i > 0 && <span className="dim"> · </span>}
          <span className={psiClass(v)}>{v != null ? Math.round(v) : "–"}</span>
        </span>
      ))}
    </span>
  );
}

function minTire(t: Trip): number | null {
  const vals = [t.tire_lf_psi, t.tire_rf_psi, t.tire_lr_psi, t.tire_rr_psi]
    .filter((v): v is number => v != null);
  return vals.length ? Math.min(...vals) : null;
}

// Per-trip efficiency vs the lifetime average, as a signed percentage.
const deltaAvg = (t: Trip, avg: number | null) =>
  t.mi_per_kwh != null && avg ? ((t.mi_per_kwh - avg) / avg) * 100 : null;

const makeCols = (avg: number | null): Col[] => [
  { key: "trip_start", label: "Start" },
  { key: "duration_min", label: "Min", fmt: (v) => v.toFixed(0) },
  { key: "distance_mi", label: "Miles", fmt: (v) => v.toFixed(1) },
  {
    key: "odometer_end",
    label: "Odo",
    fmt: (v) => v.toLocaleString("en-US", { maximumFractionDigits: 0 }),
  },
  { key: "kwh_used", label: "kWh", fmt: (v) => v.toFixed(2) },
  { key: "mi_per_kwh", label: "mi/kWh", fmt: (v) => v.toFixed(2) },
  {
    key: "efficiency_delta_avg",
    label: "Δ avg",
    render: (t) => {
      const d = deltaAvg(t, avg);
      if (d == null) return <span className="dim">—</span>;
      return (
        <span className={d >= 0 ? "pos" : "neg"}>{`${d > 0 ? "+" : ""}${d.toFixed(0)}%`}</span>
      );
    },
    sortVal: (t) => deltaAvg(t, avg),
  },
  { key: "rate_usd_per_kwh", label: "¢/kWh", fmt: (v) => (v * 100).toFixed(1) },
  { key: "energy_cost_usd", label: "Cost", fmt: (v) => `$${v.toFixed(2)}` },
  {
    key: "speed",
    label: (
      <>
        mph
        <br />
        Avg · Max
      </>
    ),
    render: (t) => {
      if (t.avg_speed_mph == null && t.max_speed_mph == null)
        return <span className="dim">—</span>;
      return (
        <span title="average · max speed (mph)">
          {t.avg_speed_mph != null ? t.avg_speed_mph.toFixed(0) : "–"}
          <span className="dim"> · </span>
          {t.max_speed_mph != null ? t.max_speed_mph.toFixed(0) : "–"}
        </span>
      );
    },
    sortVal: (t) => t.avg_speed_mph,
  },
  {
    key: "regen_kwh",
    label: (
      <>
        Regen
        <br />
        kWh
      </>
    ),
    fmt: (v) => v.toFixed(2),
  },
  { key: "soh_pct", label: "SoH", fmt: (v) => `${v.toFixed(0)}%` },
  { key: "hvb_temp_avg_f", label: "HVB °F", fmt: (v) => v.toFixed(0) },
  { key: "ambient_temp_f", label: "Amb °F", fmt: (v) => v.toFixed(0) },
  { key: "v12_soc_start", label: "12V SoC", fmt: (v) => `${v.toFixed(0)}%` },
  {
    key: "tires",
    label: (
      <>
        Tires psi
        <br />
        LF · RF · LR · RR
      </>
    ),
    render: (t) => <TireCell t={t} />,
    sortVal: minTire, // sort by the lowest corner — leaks float to the top
  },
];

export default function TripsTable({ trips, avg }: { trips: Trip[]; avg: number | null }) {
  const [sortKey, setSortKey] = useState<string>("trip_start");
  const [desc, setDesc] = useState(true);

  const cols = useMemo(() => makeCols(avg), [avg]);

  const sorted = useMemo(() => {
    const col = cols.find((c) => c.key === sortKey);
    const valueOf = (t: Trip) =>
      col?.sortVal ? col.sortVal(t) : (t[sortKey as keyof Trip] as number | string | null);
    const copy = [...trips];
    copy.sort((a, b) => {
      const av = valueOf(a);
      const bv = valueOf(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1; // nulls last regardless of direction
      if (bv == null) return -1;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return desc ? -cmp : cmp;
    });
    return copy;
  }, [trips, sortKey, desc, cols]);

  function onSort(key: string) {
    if (key === sortKey) {
      setDesc(!desc);
    } else {
      setSortKey(key);
      setDesc(true);
    }
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.key} onClick={() => onSort(c.key)} title="Click to sort">
                {c.label}
                {sortKey === c.key ? (desc ? " ↓" : " ↑") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((t) => (
            <tr key={t.id}>
              {cols.map((c) => {
                if (c.render) {
                  return <td key={c.key}>{c.render(t)}</td>;
                }
                const v = t[c.key as keyof Trip];
                if (v == null) {
                  return (
                    <td key={c.key} className="dim">
                      —
                    </td>
                  );
                }
                if (c.key === "trip_start") {
                  return <td key={c.key}>{String(v).slice(0, 16)}</td>;
                }
                const num = v as number;
                return (
                  <td key={c.key} className={c.cls ? c.cls(num) : undefined}>
                    {c.fmt ? c.fmt(num) : String(v)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
