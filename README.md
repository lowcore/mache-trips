# Mach-E Trips

Personal trip-logging pipeline for a 2023 Ford Mustang Mach-E AWD Extended
Range. Turns [Car Scanner](https://www.carscanner.info/) OBD-II CSV exports
into per-trip metrics (efficiency, energy cost, battery health, tire
pressures) stored in SQLite, with a web dashboard for trends.

## How it works

```
Car Scanner app ──export──> iCloud Drive folder
                                  │
                            watcher.py        (launchd agent on the Mac Mini)
                                  │
                            process_trip.py
                                  │
              ┌───────────────────┴───────────────────┐
      NAS share /Volumes/mache            ~/srv/mache-trips/data/
      raw/ · processed/                   trips.db
                                                  │
                                            dashboard/    (Next.js in Docker
                                                           on the Mac Mini)
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
   `trips.db` (keyed on source filename, so re-imports are harmless). The
   `raw/` and `processed/` archives live on the NAS share; `trips.db` sits on
   the Mini's own SSD at `~/srv/mache-trips/data/`, on the same host as the
   watcher that writes it (override with `MACHE_DB_DIR`).
4. The dashboard reads `trips.db` read-only — the container bind-mounts that
   same directory — and renders summary cards, efficiency/SoH/12V-battery
   charts, and a sortable trip table.

## Components

| Path | What it is |
|---|---|
| `process_trip.py` | CSV → metrics → JSON + SQLite. Stdlib only. |
| `watcher.py` | iCloud-folder watcher (needs `pip install watchdog` for live mode). |
| `rates.json` | Electricity $/kWh history; newest entry on/before the trip date applies. |
| `com.dave.machetrips.plist` | launchd agent that keeps `watcher.py` running. |
| `dashboard/` | Next.js 15 + better-sqlite3 + Recharts, Dockerized for the Mac Mini. |

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

## Deployment

Production is the Mac Mini (`MiniM4`), which is both the build host and the run
host: the image is built natively for arm64 with plain `docker build`, so there
is no cross-compile, no registry, and no rsync. `trips.db` and the launchd
watcher live on the same machine. (Everything ran on the Synology DS412+ until
2026-07-28; nothing does now.)

Everything goes through `dashboard/Makefile`:

| Target | What it does |
|---|---|
| `make build` | `docker build -t mache-dashboard:latest .` (native arm64) |
| `make srv-config` | copies the repo's `docker-compose.yml` into `~/srv/mache-trips/` |
| `make deploy` | `build` + `srv-config` + `docker compose up -d` |
| `make deploy-mini` | from a dev machine: push this commit to the Mini and deploy it there |
| `make logs` / `make status` / `make stop` / `make restart` | the obvious things |

Two things about that are worth knowing:

- **Deploy targets refuse to run anywhere but the Mini.** They act on
  `~/srv/mache-trips` on *whatever machine runs make*, so on the MBP they would
  quietly start a second, empty instance against an empty `data/` dir and exit
  0. A `require-deploy-host` guard checks `scutil --get ComputerName` and fails
  loudly instead; `DEPLOY_ANYWAY=1` overrides it.
- **From the MBP, use `make deploy-mini`.** It refuses a dirty tree (untracked
  files included), pushes `master` straight into the Mini's checkout over ssh,
  runs `make deploy` there, and then health-checks the published port — so what
  runs in production always matches a commit you can name. Run
  `make deploy-mini-setup` once per clone first. It pushes the whole repo, not
  just `dashboard/`, so `watcher.py` and `process_trip.py` are updated by the
  same command; the launchd agent still needs a restart on the Mini to pick them
  up.

The compose file in this repo is authoritative and is copied out on every
deploy. `.env` is the exception: it is hand-managed in `~/srv/mache-trips/` and
never copied. The dashboard is published on host port 3000 and reachable off-LAN
through a Cloudflare Tunnel.

The house-wide conventions behind all of this — the guard, `srv-config`, the
`deploy-mini` contract and why code travels over ssh instead of GitHub, the port
ledger — are documented in §4 of `~/dev/ARCHITECTURE.md`.

## Notes

- Trip date comes from the export filename; the CSV's SECONDS column is
  seconds since local midnight, with midnight crossings unwrapped during
  parsing.
- Raw CSVs contain per-second GPS traces, so all trip data (`*.csv`, `*.db`,
  `trip_*.json`) is gitignored — this repo holds only code.
- Constants worth knowing: EPA baseline 2.6 mi/kWh, 12V low-voltage alert at
  12.2 V, tire-pressure flags at <39 / >48 psi (42 psi placard).

## Operational docs

`DEPLOY.md` and `MAINTENANCE.md` are **not in this repo**. They hold LAN
details, so they live in iCloud at
`~/Library/Mobile Documents/com~apple~CloudDocs/dev/ops/mache-trips/` — which
syncs to both Macs without any of it reaching GitHub. The house-wide
`ARCHITECTURE.md` sits alongside them in `dev/`, aliased to `~/dev/`.
