import Database from "better-sqlite3";
import type { Monthly, Summary, Trip } from "./types";

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
