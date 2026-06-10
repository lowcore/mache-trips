import Database from "better-sqlite3";
import type { Monthly, Summary, Trip } from "./types";

export * from "./types";

const DB_PATH = process.env.TRIPS_DB ?? "/Volumes/mache/trips.db";

export function loadData(): { trips: Trip[]; monthly: Monthly[]; summary: Summary } {
  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  try {
    const trips = db
      .prepare("SELECT * FROM trips ORDER BY trip_start DESC")
      .all() as Trip[];

    const monthly = db
      .prepare(
        `SELECT strftime('%Y-%m', trip_start) AS month,
                SUM(distance_mi) * 1.0 / SUM(kwh_used) AS mi_per_kwh,
                COUNT(*) AS trips,
                AVG(ambient_temp_f) AS avg_ambient_f
         FROM trips
         WHERE kwh_used > 0 AND distance_mi > 0
         GROUP BY month
         ORDER BY month`
      )
      .all() as Monthly[];

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
