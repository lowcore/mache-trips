#!/usr/bin/env python3
"""Process a Car Scanner CSV export (2023 Mach-E AWD ER) into trip metrics.

Car Scanner exports long-format CSV: one row per PID reading.
  "SECONDS";"PID";"VALUE";"UNITS";"LATITUDE";"LONGTITUDE";
SECONDS is seconds since local midnight; the trip date comes from the
filename ("YYYY-MM-DD HH-MM-SS.csv").

Usage:
  python3 process_trip.py "/path/to/2026-06-09 17-00-58.csv" [--base /Volumes/mache] [--dry-run]
"""

import argparse
import csv
import json
import re
import shutil
import sqlite3
import sys
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path

EPA_MI_PER_KWH = 2.6          # EPA combined for 2023 Mach-E AWD Extended Range
COST_PER_KWH = 0.2            # fallback $/kWh if rates.json is missing
RATES_FILE = Path(__file__).resolve().parent / "rates.json"
DEFAULT_BASE = "/Volumes/mache"
MAX_GAP_S = 15                # ignore power-integration intervals longer than this

FILENAME_RE = re.compile(r"(\d{4}-\d{2}-\d{2})[ _](\d{2})-(\d{2})-(\d{2})")

KM_PER_MI = 1.609344


# ---------------------------------------------------------------- parsing

def parse_csv(path):
    """Return (series, units): series maps PID -> [(seconds, value)], sorted by time.

    SECONDS resets to 0 at local midnight. Rows are logged in chronological
    order, so a large backwards jump between consecutive rows means the trip
    crossed midnight; unwrap by carrying a whole-day offset forward so times
    keep increasing past 86400.
    """
    series = defaultdict(list)
    units = {}
    offset = 0.0
    prev_t = None
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.reader(f, delimiter=";")
        header = next(reader, None)
        if not header or header[0].strip('"').upper() != "SECONDS":
            raise ValueError(f"Unexpected header in {path}: {header}")
        for row in reader:
            if len(row) < 4:
                continue
            pid = row[1].strip()
            try:
                t = float(row[0])
                v = float(row[2])
            except ValueError:
                continue
            if prev_t is not None and t < prev_t - 43200:  # half a day: jitter-proof
                offset += 86400.0
            prev_t = t
            series[pid].append((t + offset, v))
            units.setdefault(pid, row[3].strip())
    for pid in series:
        series[pid].sort(key=lambda p: p[0])
    return series, units


def to_fahrenheit(value, unit):
    if value is None:
        return None
    if unit and ("℃" in unit or "C" == unit.replace("°", "").strip()):
        return value * 9 / 5 + 32
    return value


def to_miles(value, unit):
    if value is None:
        return None
    if unit and unit.strip().lower() in ("km", "kilometers"):
        return value / KM_PER_MI
    return value


def to_mph(value, unit):
    if value is None:
        return None
    if unit and unit.strip().lower() in ("km/h", "kph", "kmh"):
        return value / KM_PER_MI
    return value


class Trip:
    """Convenience accessors over the parsed PID series."""

    def __init__(self, series, units):
        self.series = series
        self.units = units

    def pick(self, *pids):
        """First PID name that has data."""
        for pid in pids:
            if self.series.get(pid):
                return pid
        return None

    def values(self, *pids):
        pid = self.pick(*pids)
        return [v for _, v in self.series[pid]] if pid else []

    def first(self, *pids):
        vals = self.values(*pids)
        return vals[0] if vals else None

    def last(self, *pids):
        vals = self.values(*pids)
        return vals[-1] if vals else None

    def maximum(self, *pids):
        vals = self.values(*pids)
        return max(vals) if vals else None

    def mean(self, *pids):
        vals = self.values(*pids)
        return sum(vals) / len(vals) if vals else None

    def unit(self, *pids):
        pid = self.pick(*pids)
        return self.units.get(pid) if pid else None

    def time_range(self):
        lo = min(pts[0][0] for pts in self.series.values() if pts)
        hi = max(pts[-1][0] for pts in self.series.values() if pts)
        return lo, hi

    def integrate_regen_kwh(self):
        """Integrate negative HV battery power (kW) over time -> kWh recaptured."""
        pts = self.series.get("HV EV Battery Power")
        if not pts or len(pts) < 2:
            return None
        kwh = 0.0
        for (t0, p0), (t1, p1) in zip(pts, pts[1:]):
            dt = t1 - t0
            if dt <= 0 or dt > MAX_GAP_S:
                continue
            neg = (min(p0, 0.0) + min(p1, 0.0)) / 2.0
            kwh += -neg * dt / 3600.0
        return round(kwh, 3)


# ---------------------------------------------------------------- metrics

def rate_for(trip_date):
    """$/kWh in effect on trip_date ("YYYY-MM-DD"), from rates.json.

    rates.json is a list of {"effective": "YYYY-MM-DD", "rate": float};
    the newest entry whose effective date is on or before the trip wins.
    """
    try:
        rates = json.loads(RATES_FILE.read_text())
    except (OSError, json.JSONDecodeError, ValueError):
        return COST_PER_KWH
    applicable = [r["rate"] for r in sorted(rates, key=lambda r: r["effective"])
                  if r["effective"] <= trip_date]
    return applicable[-1] if applicable else COST_PER_KWH


def trip_timestamps(csv_path, t_lo, t_hi):
    """Resolve absolute start/end datetimes from filename date + seconds-of-day."""
    m = FILENAME_RE.search(Path(csv_path).name)
    if m:
        base_date = datetime.strptime(m.group(1), "%Y-%m-%d")
    else:
        base_date = datetime.fromtimestamp(Path(csv_path).stat().st_mtime).replace(
            hour=0, minute=0, second=0, microsecond=0)
    # parse_csv unwraps midnight crossings, so t_hi may exceed 86400;
    # timedelta rolls that into the next day on its own.
    start = base_date + timedelta(seconds=t_lo)
    end = base_date + timedelta(seconds=t_hi)
    return start, end


def compute_metrics(trip, csv_path):
    t_lo, t_hi = trip.time_range()
    start_dt, end_dt = trip_timestamps(csv_path, t_lo, t_hi)
    duration_min = round((end_dt - start_dt).total_seconds() / 60.0, 2)

    ODO_PIDS = ("Vehicle Odometer Reading", "Odometer ECM", "Odometer BCM",
                "Odometer FSM", "Odometer PSCM")
    odo_unit = trip.unit(*ODO_PIDS)
    odo_start = to_miles(trip.first(*ODO_PIDS), odo_unit)
    odo_end = to_miles(trip.last(*ODO_PIDS), odo_unit)

    # Distance: per-trip counter is reliable; odometer PIDs are polled too
    # rarely to show a delta on short trips.
    dist_unit = trip.unit("Distance travelled")
    distance = to_miles(trip.last("Distance travelled"), dist_unit)
    if not distance and odo_start is not None and odo_end is not None:
        distance = round(odo_end - odo_start, 3) or None

    kwh = trip.last("Energy used")
    if kwh is None:
        ete_first = trip.first("[BECM] Energy to Empty")
        ete_last = trip.last("[BECM] Energy to Empty")
        if ete_first is not None and ete_last is not None:
            kwh = round(ete_first - ete_last, 3)

    mi_per_kwh = round(distance / kwh, 3) if distance and kwh else None
    kwh_per_100mi = round(kwh / distance * 100.0, 2) if distance and kwh else None
    eff_delta_pct = (round((mi_per_kwh - EPA_MI_PER_KWH) / EPA_MI_PER_KWH * 100.0, 1)
                     if mi_per_kwh else None)
    rate = rate_for(start_dt.strftime("%Y-%m-%d"))
    cost = round(kwh * rate, 4) if kwh else None

    avg_speed = to_mph(trip.last("Average speed"), trip.unit("Average speed"))
    if avg_speed is None and distance and duration_min:
        avg_speed = distance / (duration_min / 60.0)
    max_speed = to_mph(trip.maximum("Vehicle speed", "Speed (GPS)"),
                       trip.unit("Vehicle speed", "Speed (GPS)"))

    hvb_unit = trip.unit("[BECM] Temperature")
    hvb_max_unit = trip.unit("[BECM] Temperature Range Maximum", "[BECM] Temperature")

    metrics = {
        "source_file": Path(csv_path).name,
        "trip_start": start_dt.isoformat(sep=" ", timespec="seconds"),
        "trip_end": end_dt.isoformat(sep=" ", timespec="seconds"),
        "duration_min": duration_min,
        "distance_mi": round(distance, 3) if distance is not None else None,
        "odometer_start": round(odo_start, 1) if odo_start is not None else None,
        "odometer_end": round(odo_end, 1) if odo_end is not None else None,
        "kwh_used": round(kwh, 3) if kwh is not None else None,
        "mi_per_kwh": mi_per_kwh,
        "kwh_per_100mi": kwh_per_100mi,
        "efficiency_delta_pct": eff_delta_pct,
        "rate_usd_per_kwh": rate,
        "energy_cost_usd": cost,
        "avg_speed_mph": round(avg_speed, 1) if avg_speed is not None else None,
        "max_speed_mph": round(max_speed, 1) if max_speed is not None else None,
        "soh_pct": trip.first("[BECM] State of Health"),
        "hvb_temp_avg_f": (round(to_fahrenheit(trip.mean("[BECM] Temperature"), hvb_unit), 1)
                           if trip.mean("[BECM] Temperature") is not None else None),
        "hvb_temp_max_f": (round(to_fahrenheit(
            trip.maximum("[BECM] Temperature Range Maximum", "[BECM] Temperature"),
            hvb_max_unit), 1)
            if trip.maximum("[BECM] Temperature Range Maximum", "[BECM] Temperature") is not None
            else None),
        "v12_start": trip.first("Aux 12V battery voltage"),
        "v12_end": trip.last("Aux 12V battery voltage"),
        "v12_soc_start": trip.first("Aux 12V battery State of Charge"),
        "v12_soc_end": trip.last("Aux 12V battery State of Charge"),
        "v12_quiescent_ma": trip.first("Aux 12V battery standby drain/quiescent avg"),
        "v12_age_days": trip.first("Aux 12V battery reset (days)"),
        "regen_kwh": trip.integrate_regen_kwh(),
        "soc_start_pct": trip.first("[BECM] State of Charge Displayed",
                                    "[BECM] State of Charge"),
        "soc_end_pct": trip.last("[BECM] State of Charge Displayed",
                                 "[BECM] State of Charge"),
        "ambient_temp_f": (round(to_fahrenheit(
            trip.mean("Ambient air temperature", "Outside Temperature"),
            trip.unit("Ambient air temperature", "Outside Temperature")), 1)
            if trip.mean("Ambient air temperature", "Outside Temperature") is not None
            else None),
        # Trip-average tire pressures (psi); sparse PIDs, mean smooths the
        # warm-up rise enough for cross-trip slow-leak comparison.
        "tire_lf_psi": (round(trip.mean("Left Front Tire Pressure (Driver Front)"), 1)
                        if trip.mean("Left Front Tire Pressure (Driver Front)") is not None else None),
        "tire_rf_psi": (round(trip.mean("Right Front Tire Pressure (Passenger Front)"), 1)
                        if trip.mean("Right Front Tire Pressure (Passenger Front)") is not None else None),
        "tire_lr_psi": (round(trip.mean("Left Rear Tire Pressure (Driver Rear)"), 1)
                        if trip.mean("Left Rear Tire Pressure (Driver Rear)") is not None else None),
        "tire_rr_psi": (round(trip.mean("Right Rear Tire Pressure (Passenger Rear)"), 1)
                        if trip.mean("Right Rear Tire Pressure (Passenger Rear)") is not None else None),
        "created_at": datetime.now().isoformat(sep=" ", timespec="seconds"),
    }
    return metrics


def is_junk_trip(metrics):
    """True for logs with no usable drive data — e.g. Car Scanner left
    connected to the OBDLink after a drive exports a near-empty log."""
    return not metrics["distance_mi"] and not metrics["kwh_used"]


# ---------------------------------------------------------------- outputs

DDL = """
CREATE TABLE IF NOT EXISTS trips (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    source_file          TEXT UNIQUE NOT NULL,
    trip_start           TEXT,
    trip_end             TEXT,
    duration_min         REAL,
    distance_mi          REAL,
    odometer_start       REAL,
    odometer_end         REAL,
    kwh_used             REAL,
    mi_per_kwh           REAL,
    kwh_per_100mi        REAL,
    efficiency_delta_pct REAL,
    rate_usd_per_kwh     REAL,
    energy_cost_usd      REAL,
    avg_speed_mph        REAL,
    max_speed_mph        REAL,
    soh_pct              REAL,
    hvb_temp_avg_f       REAL,
    hvb_temp_max_f       REAL,
    v12_start            REAL,
    v12_end              REAL,
    v12_soc_start        REAL,
    v12_soc_end          REAL,
    v12_quiescent_ma     REAL,
    v12_age_days         REAL,
    regen_kwh            REAL,
    soc_start_pct        REAL,
    soc_end_pct          REAL,
    ambient_temp_f       REAL,
    tire_lf_psi          REAL,
    tire_rf_psi          REAL,
    tire_lr_psi          REAL,
    tire_rr_psi          REAL,
    created_at           TEXT
);
"""

DB_COLUMNS = [
    "source_file", "trip_start", "trip_end", "duration_min", "distance_mi",
    "odometer_start", "odometer_end", "kwh_used", "mi_per_kwh", "kwh_per_100mi",
    "efficiency_delta_pct", "rate_usd_per_kwh", "energy_cost_usd",
    "avg_speed_mph", "max_speed_mph",
    "soh_pct", "hvb_temp_avg_f", "hvb_temp_max_f", "v12_start", "v12_end",
    "v12_soc_start", "v12_soc_end", "v12_quiescent_ma", "v12_age_days",
    "regen_kwh", "soc_start_pct", "soc_end_pct", "ambient_temp_f",
    "tire_lf_psi", "tire_rf_psi", "tire_lr_psi", "tire_rr_psi", "created_at",
]


def ensure_schema(con):
    """Create the trips table, then add any columns missing from older DBs."""
    con.execute(DDL)
    existing = {row[1] for row in con.execute("PRAGMA table_info(trips)")}
    for col in DB_COLUMNS:
        if col not in existing:
            coltype = "TEXT" if col in ("source_file", "trip_start", "trip_end",
                                        "created_at") else "REAL"
            con.execute(f"ALTER TABLE trips ADD COLUMN {col} {coltype}")


def write_outputs(metrics, csv_path, base):
    base = Path(base)
    processed_dir = base / "processed"
    raw_dir = base / "raw"
    processed_dir.mkdir(parents=True, exist_ok=True)
    raw_dir.mkdir(parents=True, exist_ok=True)

    stamp = metrics["trip_start"].replace("-", "").replace(":", "").replace(" ", "_")
    json_path = processed_dir / f"trip_{stamp}.json"
    json_path.write_text(json.dumps(metrics, indent=2) + "\n")

    db_path = base / "trips.db"
    con = sqlite3.connect(db_path)
    try:
        ensure_schema(con)
        placeholders = ",".join("?" * len(DB_COLUMNS))
        updates = ",".join(f"{c}=excluded.{c}" for c in DB_COLUMNS if c != "source_file")
        existed = con.execute("SELECT 1 FROM trips WHERE source_file=?",
                              (metrics["source_file"],)).fetchone()
        con.execute(
            f"INSERT INTO trips ({','.join(DB_COLUMNS)}) VALUES ({placeholders}) "
            f"ON CONFLICT(source_file) DO UPDATE SET {updates}",
            [metrics[c] for c in DB_COLUMNS],
        )
        inserted = existed is None
        con.commit()
    finally:
        con.close()

    archive_path = raw_dir / Path(csv_path).name
    if Path(csv_path).resolve() != archive_path.resolve():
        shutil.copy2(csv_path, archive_path)

    return json_path, db_path, inserted


def main():
    ap = argparse.ArgumentParser(description="Process a Car Scanner trip CSV")
    ap.add_argument("csv_file", help="Car Scanner CSV export")
    ap.add_argument("--base", default=DEFAULT_BASE,
                    help=f"Output base dir containing raw/, processed/, trips.db (default {DEFAULT_BASE})")
    ap.add_argument("--dry-run", action="store_true",
                    help="Print metrics only; write nothing")
    args = ap.parse_args()

    csv_path = Path(args.csv_file)
    if not csv_path.is_file():
        sys.exit(f"error: no such file: {csv_path}")

    series, units = parse_csv(csv_path)
    if not series:
        sys.exit(f"error: no parsable PID rows in {csv_path}")

    trip = Trip(series, units)
    metrics = compute_metrics(trip, csv_path)
    print(json.dumps(metrics, indent=2))

    missing = [k for k, v in metrics.items() if v is None]
    if missing:
        print(f"\nnote: missing PIDs for: {', '.join(missing)}", file=sys.stderr)

    if is_junk_trip(metrics):
        # Archive the CSV anyway so a misclassified trip is recoverable by
        # reprocessing from raw/; just don't pollute the DB or processed/.
        print("\nskipped import: no distance and no energy recorded "
              "(partial/corrupted log)")
        if not args.dry_run:
            raw_dir = Path(args.base) / "raw"
            raw_dir.mkdir(parents=True, exist_ok=True)
            archive_path = raw_dir / csv_path.name
            if csv_path.resolve() != archive_path.resolve():
                shutil.copy2(csv_path, archive_path)
            print(f"archived CSV to {archive_path}")
        return

    if args.dry_run:
        return

    json_path, db_path, inserted = write_outputs(metrics, csv_path, args.base)
    print(f"\nwrote {json_path}")
    print(f"{'inserted into' if inserted else 'updated existing row in'} {db_path}")
    print(f"archived CSV to {Path(args.base) / 'raw' / csv_path.name}")


if __name__ == "__main__":
    main()
