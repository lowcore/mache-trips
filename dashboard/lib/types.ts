// Shared types and constants — safe to import from client components.
// Keep all Node-only code (better-sqlite3) in lib/db.ts.

export const EPA_MI_PER_KWH = 2.6;
export const V12_LOW_THRESHOLD = 12.2;
// Mach-E door placard is 42 psi cold; flag a likely leak well before the
// TPMS light (~25% loss), and overinflation beyond normal warm-tire rise.
export const TIRE_LOW_PSI = 39;
export const TIRE_HIGH_PSI = 48;

export type Trip = {
  id: number;
  source_file: string;
  trip_start: string;
  trip_end: string;
  duration_min: number | null;
  distance_mi: number | null;
  odometer_start: number | null;
  odometer_end: number | null;
  kwh_used: number | null;
  mi_per_kwh: number | null;
  kwh_per_100mi: number | null;
  efficiency_delta_pct: number | null;
  rate_usd_per_kwh: number | null;
  energy_cost_usd: number | null;
  avg_speed_mph: number | null;
  max_speed_mph: number | null;
  soh_pct: number | null;
  hvb_temp_avg_f: number | null;
  hvb_temp_max_f: number | null;
  v12_start: number | null;
  v12_end: number | null;
  v12_soc_start: number | null;
  v12_soc_end: number | null;
  v12_quiescent_ma: number | null;
  v12_age_days: number | null;
  regen_kwh: number | null;
  soc_start_pct: number | null;
  soc_end_pct: number | null;
  ambient_temp_f: number | null;
  tire_lf_psi: number | null;
  tire_rf_psi: number | null;
  tire_lr_psi: number | null;
  tire_rr_psi: number | null;
};

export type Monthly = {
  month: string;
  mi_per_kwh: number;
  trips: number;
  avg_ambient_f: number | null;
  logged_miles: number; // sum of per-trip distance_mi (logged drives only)
  odo_miles: number | null; // odometer delta across the month (all driving); null if no readings
};

export type Summary = {
  totalTrips: number;
  totalMiles: number;
  totalKwh: number;
  totalCost: number;
  avgEfficiency: number | null; // total miles / total kWh over trips with both
};
