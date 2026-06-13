import TripsTable from "@/components/TripsTable";
import {
  EfficiencyTrend,
  MonthlyBars,
  SohTrend,
  V12Chart,
  type ChartPoint,
} from "@/components/charts";
import { EPA_MI_PER_KWH, V12_LOW_THRESHOLD, loadData, type Trip } from "@/lib/db";

export const dynamic = "force-dynamic"; // re-read trips.db on every page load

function shortLabel(ts: string) {
  // "2026-06-09 17:00:58" -> "6/9 17:00"
  const m = ts.match(/^\d{4}-(\d{2})-(\d{2}) (\d{2}:\d{2})/);
  if (!m) return ts;
  return `${Number(m[1])}/${Number(m[2])} ${m[3]}`;
}

function fmt(n: number | null | undefined, digits = 1, suffix = "") {
  if (n == null) return "—";
  return (
    n.toLocaleString("en-US", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }) + suffix
  );
}

export default function Page() {
  const { trips, monthly, summary } = loadData();

  const chrono = [...trips].reverse();
  const points: ChartPoint[] = chrono.map((t: Trip) => ({
    ts: new Date(t.trip_start.replace(" ", "T")).getTime(), // local time -> epoch ms
    label: shortLabel(t.trip_start),
    mi_per_kwh: t.mi_per_kwh,
    soh_pct: t.soh_pct,
    hvb_temp_avg_f: t.hvb_temp_avg_f,
    soc_depth:
      t.soc_start_pct != null && t.soc_end_pct != null
        ? Number((t.soc_start_pct - t.soc_end_pct).toFixed(1))
        : null,
    v12_start: t.v12_start,
    v12_end: t.v12_end,
    v12_soc_start: t.v12_soc_start,
  }));

  const monthlyData = monthly.map((m) => ({
    ...m,
    mi_per_kwh: Number(m.mi_per_kwh.toFixed(2)),
  }));

  const lowV12 = trips.filter(
    (t) =>
      (t.v12_start != null && t.v12_start < V12_LOW_THRESHOLD) ||
      (t.v12_end != null && t.v12_end < V12_LOW_THRESHOLD)
  );

  const latest = trips[0];
  const latestSoh = trips.find((t) => t.soh_pct != null)?.soh_pct;
  const latestQuiescent = trips.find((t) => t.v12_quiescent_ma != null)?.v12_quiescent_ma;
  const latestAge = trips.find((t) => t.v12_age_days != null)?.v12_age_days;

  return (
    <main>
      <header className="page">
        <h1>⚡ Mach-E Trips</h1>
        <span className="sub">
          2023 Mustang Mach-E AWD ER · {latest ? `last trip ${latest.trip_start.slice(0, 16)}` : "no trips yet"}
        </span>
      </header>

      <section>
        <div className="cards">
          <div className="card">
            <div className="label">Trips</div>
            <div className="value">{summary.totalTrips}</div>
          </div>
          <div className="card">
            <div className="label">Total miles</div>
            <div className="value">{fmt(summary.totalMiles, 1)}</div>
          </div>
          <div className="card">
            <div className="label">Avg efficiency</div>
            <div className="value">{fmt(summary.avgEfficiency, 2)}</div>
            <div className="hint">mi/kWh · EPA {EPA_MI_PER_KWH}</div>
          </div>
          <div className="card">
            <div className="label">Energy used</div>
            <div className="value">{fmt(summary.totalKwh, 1)} kWh</div>
          </div>
          <div className="card">
            <div className="label">Energy cost</div>
            <div className="value">${fmt(summary.totalCost, 2)}</div>
          </div>
        </div>
      </section>

      <section>
        <h2>Efficiency trend</h2>
        <div className="panel">
          <EfficiencyTrend data={points} epa={EPA_MI_PER_KWH} />
        </div>
      </section>

      <section className="grid-2">
        <div>
          <h2>Monthly miles &amp; efficiency</h2>
          <div className="panel">
            <MonthlyBars data={monthlyData} epa={EPA_MI_PER_KWH} />
          </div>
        </div>
        <div>
          <h2>Battery health &amp; stress</h2>
          <div className="panel">
            <SohTrend data={points} />
            <div className="statline">
              <span>
                Current SoH <b>{latestSoh != null ? `${latestSoh}%` : "—"}</b>
              </span>
            </div>
          </div>
        </div>
      </section>

      <section>
        <h2>12V battery</h2>
        <div className="panel">
          <V12Chart data={points} threshold={V12_LOW_THRESHOLD} />
          {lowV12.length === 0 ? (
            <div className="alert ok">
              All 12V readings at or above {V12_LOW_THRESHOLD} V
            </div>
          ) : (
            <div className="alert bad">
              {lowV12.length} trip{lowV12.length > 1 ? "s" : ""} with readings below{" "}
              {V12_LOW_THRESHOLD} V:{" "}
              {lowV12
                .map((t) => `${t.trip_start.slice(0, 16)} (${t.v12_start ?? "?"}→${t.v12_end ?? "?"} V)`)
                .join(", ")}
            </div>
          )}
          <div className="statline">
            <span>
              Quiescent drain <b>{latestQuiescent != null ? `${latestQuiescent} mA` : "—"}</b>
            </span>
            <span>
              Battery age{" "}
              <b>
                {latestAge != null
                  ? `${Math.round(latestAge)} days (${(latestAge / 365).toFixed(1)} yr)`
                  : "—"}
              </b>
            </span>
            <span>
              Last 12V SoC{" "}
              <b>
                {latest?.v12_soc_start != null && latest?.v12_soc_end != null
                  ? `${latest.v12_soc_start}% → ${latest.v12_soc_end}%`
                  : "—"}
              </b>
            </span>
          </div>
        </div>
      </section>

      <section>
        <h2>Trip history</h2>
        <TripsTable trips={trips} />
      </section>
    </main>
  );
}
