# Mach-E Trips

Personal trip-logging pipeline for a 2023 Ford Mustang Mach-E AWD Extended
Range. Turns [Car Scanner](https://www.carscanner.info/) OBD-II CSV exports
into per-trip metrics (efficiency, energy cost, battery health, tire
pressures) stored in SQLite, with a web dashboard for trends.

## How it works

```
Car Scanner app ──export──> iCloud Drive folder
                                  │
                            watcher.py        (launchd agent on the Mac)
                                  │
                            process_trip.py
                                  │
                  NAS share: raw/ · processed/ · trips.db
                                  │
                            dashboard/        (Next.js in Docker on the NAS)
```

1. After a drive, Car Scanner exports its log (`exported_records.zip`) to a
   folder on iCloud Drive. NOTE: You must manually disconnect Car Scanner from
   OBDLink or you will get incomplete logs.
2. `watcher.py` runs continuously via launchd, notices the new file, waits
   for iCloud to finish syncing, unzips it, and feeds each CSV to
   `process_trip.py`. Sources are deleted after a fully successful import;
   failures (including partial-zip failures) are quarantined to `failed/`
   for inspection.
3. `process_trip.py` parses the long-format PID log, computes trip metrics,
   archives the raw CSV, writes a JSON summary, and upserts a row into
   `trips.db` (keyed on source filename, so re-imports are harmless).
4. The dashboard reads `trips.db` read-only and renders summary cards,
   efficiency/SoH/12V-battery charts, and a sortable trip table. A second
   page, `/maintenance`, projects service intervals off the current odometer.

## Components

| Path | What it is |
|---|---|
| `process_trip.py` | CSV → metrics → JSON + SQLite. Stdlib only. |
| `watcher.py` | iCloud-folder watcher (needs `pip install watchdog` for live mode). |
| `rates.json` | Electricity $/kWh history; newest entry on/before the trip date applies. |
| `com.dave.machetrips.plist` | launchd agent that keeps `watcher.py` running. |
| `dashboard/` | Next.js 15 + better-sqlite3 + Recharts, Dockerized for the Mac Mini. |
| `dashboard/lib/maintenance.ts` | Static service schedule + part numbers behind `/maintenance`. |

## Usage

Process a single export by hand:

```bash
python3 process_trip.py "/path/to/2026-06-09 17-00-58.csv" --dry-run   # print metrics only
python3 process_trip.py "/path/to/2026-06-09 17-00-58.csv"             # write JSON + DB + archive
```

Run the watcher once over the export folder (no watchdog needed):

```bash
python3 watcher.py --once
```

Install the launchd agent:

```bash
cp com.dave.machetrips.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.dave.machetrips.plist
```

Dashboard, locally:

```bash
cd dashboard
npm install
TRIPS_DB=/path/to/trips.db npm run dev
```

NAS deployment (rsync + docker-compose + Cloudflare Tunnel) is documented in
`DEPLOY.md`, which is gitignored because it contains LAN details.

## Maintenance page

`/maintenance` turns the current odometer (max reading in `trips.db`) into a
"what's next" list, and carries the OEM part number for anything orderable so
a DIY job can be shopped for without hunting a catalog. Due dates are
projected from the trailing-90-day driving pace.

Two things it deliberately does not do:

- **No service history.** Nothing records what has actually been done, so
  "next due" is only the next interval boundary ahead of the odometer — it can
  never show an item as overdue. Adding history means a writable store; the
  container's data mount is read-only today.
- **No time-based tracking.** Brake fluid and coolant run on a clock, not a
  trip meter, and nothing in `trips.db` records the in-service date. They're
  listed with their intervals but excluded from the projections.

Part numbers are marked `confirmed` (agreed across sources including a Ford
dealer catalog) or `verify` (corroborated, but forums/retailers only) and each
links to a search. Ford's own PDF at `vdm.ford.com` 404s and
`fordservicecontent.com` refuses automated fetches, so intervals came from
corroborated secondary sources — FordPass stays authoritative for warranty.

## Notes

- Trip date comes from the export filename; the CSV's SECONDS column is
  seconds since local midnight, with midnight crossings unwrapped during
  parsing.
- Raw CSVs contain per-second GPS traces, so all trip data (`*.csv`, `*.db`,
  `trip_*.json`) is gitignored — this repo holds only code.
- Constants worth knowing: EPA baseline 2.6 mi/kWh, 12V low-voltage alert at
  12.2 V, tire-pressure flags at <39 / >48 psi (42 psi placard).

## Operational docs

`DEPLOY.md` and `MAINTENANCE.md` are **not in this repo**. They contain LAN
addresses, the NAS SSH port, and share layout, so they live in iCloud at
`~/Library/Mobile Documents/com~apple~CloudDocs/dev/ops/mache-trips/` — which
syncs to both Macs without any of it reaching GitHub. The house-wide
`ARCHITECTURE.md` sits alongside them in `dev/`.
