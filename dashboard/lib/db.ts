import Database from "better-sqlite3";
import type { Monthly, OdometerState, Summary, Trip } from "./types";
import { PACE_MIN_SPAN_DAYS, PACE_WINDOW_DAYS } from "./types";

export * from "./types";

const DB_PATH = process.env.TRIPS_DB ?? "/Volumes/mache/trips.db";

const monthOf = (trip_start: string) => trip_start.slice(0, 7); // "YYYY-MM"

/**
 * Odometer-derived miles driven per month — captures ALL driving, including
 * trips logged without Car Scanner. Odometer readings are sparse and rarely
 * land exactly on a month boundary, so we carry the last reading of each month
 * forward as the baseline for the next: month N miles = lastOdo[N] - lastOdo[N-1].
 * The first month with data falls back to its own (last - first) reading, which
 * undercounts any driving before that first reading. Months with no reading at
 * all yield null (a gap); the carried baseline is preserved so error doesn't
 * accumulate across the gap.
 */
function monthlyOdoMiles(trips: Trip[]): Map<string, number | null> {
  const withOdo = trips
    .map((t) => ({
      month: monthOf(t.trip_start),
      ts: t.trip_start,
      first: t.odometer_start ?? t.odometer_end,
      last: t.odometer_end ?? t.odometer_start,
    }))
    .filter((r) => r.first != null && r.last != null)
    .sort((a, b) => a.ts.localeCompare(b.ts)); // ascending

  const firstOdo = new Map<string, number>();
  const lastOdo = new Map<string, number>();
  for (const r of withOdo) {
    if (!firstOdo.has(r.month)) firstOdo.set(r.month, r.first as number);
    lastOdo.set(r.month, r.last as number); // ends on the latest trip in the month
  }

  const months = [...new Set(trips.map((t) => monthOf(t.trip_start)))].sort();
  const result = new Map<string, number | null>();
  let prevEnd: number | null = null;
  for (const m of months) {
    const end = lastOdo.get(m);
    if (end == null) {
      result.set(m, null); // no reading this month → gap, baseline carried forward
      continue;
    }
    const baseline = prevEnd ?? (firstOdo.get(m) as number);
    result.set(m, Math.max(0, Math.round(end - baseline)));
    prevEnd = end;
  }
  return result;
}

/**
 * Current odometer and how fast miles are accruing — everything the
 * maintenance page needs, without loading every trip row.
 *
 * Odometer PIDs are polled opportunistically, so any given trip may have a
 * start reading, an end reading, both or neither. Take the max across both
 * columns rather than trusting odometer_end: a trip whose end reading was
 * missed would otherwise drag the "current" reading backwards. The COALESCE
 * inside MAX() is load-bearing — SQLite's scalar MAX() returns NULL if ANY
 * argument is NULL, so MAX(end, start) would blank out exactly the
 * half-populated rows this is meant to rescue.
 *
 * Pace is a plain (last - first) / days over the trailing window rather than
 * an average of per-trip distances, so unlogged driving still counts — the
 * odometer sees every mile, Car Scanner only sees the trips it recorded.
 */
export function loadOdometerState(): OdometerState {
  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  try {
    const latest = db
      .prepare(
        `SELECT trip_start, MAX(COALESCE(odometer_end, 0), COALESCE(odometer_start, 0)) AS odo
         FROM trips
         WHERE odometer_end IS NOT NULL OR odometer_start IS NOT NULL
         ORDER BY odo DESC
         LIMIT 1`
      )
      .get() as { trip_start: string; odo: number } | undefined;

    if (!latest) return { odometer: null, readingAt: null, milesPerDay: null };

    // Oldest reading still inside the pace window, to measure the span from.
    const oldest = db
      .prepare(
        `SELECT trip_start, MAX(COALESCE(odometer_end, 0), COALESCE(odometer_start, 0)) AS odo
         FROM trips
         WHERE (odometer_end IS NOT NULL OR odometer_start IS NOT NULL)
           AND julianday(?) - julianday(trip_start) <= ?
         ORDER BY trip_start ASC
         LIMIT 1`
      )
      .get(latest.trip_start, PACE_WINDOW_DAYS) as
      | { trip_start: string; odo: number }
      | undefined;

    let milesPerDay: number | null = null;
    if (oldest) {
      const spanDays =
        (Date.parse(latest.trip_start.replace(" ", "T")) -
          Date.parse(oldest.trip_start.replace(" ", "T"))) /
        86_400_000;
      const miles = latest.odo - oldest.odo;
      if (spanDays >= PACE_MIN_SPAN_DAYS && miles > 0) {
        milesPerDay = miles / spanDays;
      }
    }

    return { odometer: latest.odo, readingAt: latest.trip_start, milesPerDay };
  } finally {
    db.close();
  }
}

export function loadData(): { trips: Trip[]; monthly: Monthly[]; summary: Summary } {
  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  try {
    const trips = db
      .prepare("SELECT * FROM trips ORDER BY trip_start DESC")
      .all() as Trip[];

    // Efficiency + ambient per month (only trips with both distance and energy).
    const effRows = db
      .prepare(
        `SELECT strftime('%Y-%m', trip_start) AS month,
                SUM(distance_mi) * 1.0 / SUM(kwh_used) AS mi_per_kwh,
                AVG(ambient_temp_f) AS avg_ambient_f
         FROM trips
         WHERE kwh_used > 0 AND distance_mi > 0
         GROUP BY month`
      )
      .all() as { month: string; mi_per_kwh: number; avg_ambient_f: number | null }[];
    const effByMonth = new Map(effRows.map((r) => [r.month, r]));

    // Miles per month: logged-trip distance (JS, no kwh filter so distance-only
    // trips still count) and odometer-derived total (carry-forward).
    const odoByMonth = monthlyOdoMiles(trips);
    const loggedByMonth = new Map<string, number>();
    const tripsByMonth = new Map<string, number>();
    for (const t of trips) {
      const m = monthOf(t.trip_start);
      tripsByMonth.set(m, (tripsByMonth.get(m) ?? 0) + 1);
      if (t.distance_mi != null) {
        loggedByMonth.set(m, (loggedByMonth.get(m) ?? 0) + t.distance_mi);
      }
    }

    const monthly: Monthly[] = [...new Set(trips.map((t) => monthOf(t.trip_start)))]
      .sort()
      .map((month) => ({
        month,
        mi_per_kwh: effByMonth.get(month)?.mi_per_kwh ?? 0,
        avg_ambient_f: effByMonth.get(month)?.avg_ambient_f ?? null,
        trips: tripsByMonth.get(month) ?? 0,
        logged_miles: Math.round((loggedByMonth.get(month) ?? 0) * 10) / 10,
        odo_miles: odoByMonth.get(month) ?? null,
      }));

    const agg = db
      .prepare(
        `SELECT COUNT(*) AS totalTrips,
                COALESCE(SUM(distance_mi), 0) AS totalMiles,
                COALESCE(SUM(kwh_used), 0) AS totalKwh,
                COALESCE(SUM(energy_cost_usd), 0) AS totalCost
         FROM trips`
      )
      .get() as { totalTrips: number; totalMiles: number; totalKwh: number; totalCost: number };

    const eff = db
      .prepare(
        `SELECT SUM(distance_mi) * 1.0 / SUM(kwh_used) AS e
         FROM trips WHERE kwh_used > 0 AND distance_mi > 0`
      )
      .get() as { e: number | null };

    return {
      trips,
      monthly,
      summary: { ...agg, avgEfficiency: eff.e },
    };
  } finally {
    db.close();
  }
}
