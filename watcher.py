#!/usr/bin/env python3
"""Watch the Car Scanner iCloud export folder and process new trip files.

Car Scanner exports land in the mache folder on iCloud Drive, typically as
"exported_records.zip" (the app's default name, reused on every export — so
filenames cannot be used for dedup). This watcher:

  1. Monitors the folder for ANY new .zip / .csv file (watchdog events plus
     a periodic rescan for backlog and anything missed)
  2. Waits until the file size is stable for 3 s (iCloud sync delay)
  3. Unzips if needed and runs process_trip.py on each CSV inside
  4. DELETES the source file after fully successful processing (the trip CSV
     is archived to <base>/raw/ by process_trip.py first). Duplicate imports
     are prevented by the DB's unique source_file constraint, not filenames.
  5. Moves failed or partially-failed files to <watch_dir>/failed/ instead
     of deleting
  6. Leaves files in place for retry when the NAS share is not mounted
  7. Logs to ~/logs/mache_watcher.log
  8. Asks iCloud to download any .icloud placeholder files it finds

Usage:
  python3 watcher.py                 # run forever (needs: pip install watchdog)
  python3 watcher.py --once          # single scan, then exit (no watchdog needed)
  python3 watcher.py --watch-dir DIR --base DIR   # overrides for testing

Requires: python3 -m pip install watchdog   (live mode only)
"""

import argparse
import logging
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import zipfile
from datetime import datetime
from pathlib import Path

WATCH_DIR = Path.home() / "Library/Mobile Documents/com~apple~CloudDocs/mache"
BASE_DIR = Path("/Volumes/mache")
LOG_DIR = Path(os.environ.get("MACHE_LOG_DIR", Path.home() / "logs"))
LOG_FILE = LOG_DIR / "mache_watcher.log"
PROCESS_SCRIPT = Path(__file__).resolve().parent / "process_trip.py"

STABLE_SECONDS = 3        # file size must be unchanged this long
STABLE_TIMEOUT = 180      # give up waiting for a file to settle
RESCAN_INTERVAL = 300     # periodic catch-up scan, seconds

log = logging.getLogger("mache_watcher")

# Serializes processing between the watchdog event thread and the rescan
# loop so the same file is never handled twice concurrently.
_work_lock = threading.Lock()


class RetryLater(Exception):
    """Abandon the current source and leave it in place for the next rescan.

    Raised for environmental failures (process_trip timed out, or couldn't be
    launched at all) rather than bad file content. The source is neither
    deleted nor quarantined, so it's retried automatically once the
    environment recovers."""


def setup_logging():
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(message)s")
    log.setLevel(logging.INFO)
    handlers = [logging.FileHandler(LOG_FILE)]
    if sys.stdout.isatty():  # under launchd, stdout already goes to LOG_FILE
        handlers.append(logging.StreamHandler())
    for handler in handlers:
        handler.setFormatter(fmt)
        log.addHandler(handler)


def wait_for_stable(path):
    """Wait until file size is unchanged for STABLE_SECONDS. False on timeout."""
    deadline = time.time() + STABLE_TIMEOUT
    last_size, stable_since = -1, time.time()
    while time.time() < deadline:
        try:
            size = path.stat().st_size
        except FileNotFoundError:
            return False
        if size != last_size:
            last_size, stable_since = size, time.time()
        elif size > 0 and time.time() - stable_since >= STABLE_SECONDS:
            return True
        time.sleep(1)
    return False


def request_icloud_download(path):
    """Ask iCloud to materialize a .icloud placeholder (Optimize Mac Storage)."""
    try:
        subprocess.run(["brctl", "download", str(path)], capture_output=True, timeout=30)
        log.info("requested iCloud download: %s", path.name)
    except (OSError, subprocess.TimeoutExpired) as e:
        log.warning("brctl download failed for %s: %s", path.name, e)


SF_DATALESS = 0x40000000  # APFS: file metadata is local but bytes are in iCloud


def is_dataless(path):
    """True if the file appears full-size but its content isn't downloaded yet."""
    try:
        st = path.stat()
    except FileNotFoundError:
        return False
    return bool(st.st_flags & SF_DATALESS) or (st.st_size > 0 and st.st_blocks == 0)


def ensure_local(path, timeout=120):
    """Trigger an iCloud download if needed and wait for the bytes to arrive."""
    if not is_dataless(path):
        return True
    request_icloud_download(path)
    deadline = time.time() + timeout
    while time.time() < deadline:
        if not is_dataless(path):
            return True
        time.sleep(2)
    log.warning("iCloud download timed out, will retry: %s", path.name)
    return False


def run_process_trip(csv_path, base):
    cmd = [sys.executable, str(PROCESS_SCRIPT), str(csv_path), "--base", str(base)]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    except subprocess.TimeoutExpired:
        log.warning("process_trip timed out (>300s), will retry on next scan: %s",
                    csv_path.name)
        raise RetryLater
    except OSError as e:
        # e.g. the venv interpreter was deleted mid-run (Homebrew python
        # upgrade). Environmental, not a bad file — leave it for retry.
        log.warning("could not launch process_trip (%s), will retry on next scan: %s",
                    e, csv_path.name)
        raise RetryLater
    if result.returncode == 0:
        for line in result.stdout.strip().split("\n"):
            if line.startswith(("wrote", "inserted", "updated", "archived", "skipped")):
                log.info("  %s", line)
        return True
    log.error("process_trip failed for %s: %s", csv_path.name,
              (result.stderr or result.stdout).strip().split("\n")[-1])
    return False


def quarantine(path, watch_dir):
    """Move an unparseable file to <watch_dir>/failed/ rather than deleting it."""
    failed_dir = watch_dir / "failed"
    failed_dir.mkdir(exist_ok=True)
    dest = failed_dir / path.name
    if dest.exists():
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        dest = failed_dir / f"{path.stem}-{stamp}{path.suffix}"
    shutil.move(str(path), str(dest))
    log.warning("moved to %s", dest)


def process_file(path, watch_dir, base):
    """Handle one .zip or .csv: process, then delete (or quarantine on failure)."""
    with _work_lock:
        if not path.is_file():  # already handled by the other thread
            return
        name = path.name
        if not base.is_dir():
            log.error("NAS base %s not available — leaving %s for retry", base, name)
            return
        if not ensure_local(path):
            return
        if not wait_for_stable(path):
            log.warning("file never stabilized, will retry on next scan: %s", name)
            return

        log.info("processing %s", name)
        succeeded = failed = 0
        try:
            if path.suffix.lower() == ".zip":
                try:
                    with zipfile.ZipFile(path) as zf:
                        members = [m for m in zf.namelist()
                                   if m.lower().endswith(".csv") and not m.startswith("__MACOSX")]
                        with tempfile.TemporaryDirectory() as tmp:
                            for member in members:
                                extracted = Path(zf.extract(member, tmp))
                                if run_process_trip(extracted, base):
                                    succeeded += 1
                                else:
                                    failed += 1
                except zipfile.BadZipFile:
                    log.error("bad zip (corrupt or still syncing?), will retry: %s", name)
                    return
                if not members:
                    log.warning("no CSVs inside %s", name)
            else:
                if run_process_trip(path, base):
                    succeeded += 1
                else:
                    failed += 1
        except RetryLater:
            return  # source left in place; the next rescan retries it

        if succeeded and not failed:
            # Trip CSVs are archived in <base>/raw/, so the source is redundant.
            path.unlink()
            log.info("done %s (%d trip%s imported) — source deleted",
                     name, succeeded, "s" if succeeded != 1 else "")
        elif succeeded:
            # Partial success: keep the source so the failed CSVs aren't lost.
            # Reprocessing the imported ones later is a harmless upsert.
            log.warning("done %s (%d imported, %d failed) — quarantining source",
                        name, succeeded, failed)
            quarantine(path, watch_dir)
        else:
            quarantine(path, watch_dir)


def is_candidate(path):
    return (path.is_file()
            and not path.name.startswith(".")
            and path.suffix.lower() in (".zip", ".csv"))


def scan(watch_dir, base):
    """Process every candidate file present; trigger downloads for placeholders."""
    if not watch_dir.is_dir():
        log.error("watch dir missing: %s", watch_dir)
        return
    for placeholder in watch_dir.glob("*.icloud"):
        real_name = placeholder.name.removeprefix(".").removesuffix(".icloud")
        if real_name.lower().endswith((".zip", ".csv")):
            request_icloud_download(placeholder)
    for path in sorted(watch_dir.iterdir()):
        if is_candidate(path):
            process_file(path, watch_dir, base)


def watch(watch_dir, base):
    from watchdog.events import FileSystemEventHandler
    from watchdog.observers import Observer

    real_watch_dir = watch_dir.resolve()  # FSEvents reports symlink-resolved paths

    class Handler(FileSystemEventHandler):
        def _maybe(self, src):
            path = Path(src)
            if path.parent.resolve() != real_watch_dir:
                return
            if path.name.endswith(".icloud"):  # Optimize Mac Storage placeholder
                real_name = path.name.removeprefix(".").removesuffix(".icloud")
                if real_name.lower().endswith((".zip", ".csv")):
                    request_icloud_download(path)
                return
            if is_candidate(path):
                process_file(path, watch_dir, base)

        def on_created(self, event):
            if not event.is_directory:
                self._maybe(event.src_path)

        def on_moved(self, event):  # iCloud writes tmp files then renames
            if not event.is_directory:
                self._maybe(event.dest_path)

    observer = Observer()
    observer.schedule(Handler(), str(watch_dir), recursive=False)
    observer.start()
    log.info("watching %s (rescan every %ds)", watch_dir, RESCAN_INTERVAL)
    try:
        while True:
            time.sleep(RESCAN_INTERVAL)
            scan(watch_dir, base)
    except KeyboardInterrupt:
        log.info("stopping")
    finally:
        observer.stop()
        observer.join()


def main():
    ap = argparse.ArgumentParser(description="Watch for Car Scanner exports")
    ap.add_argument("--watch-dir", default=str(WATCH_DIR))
    ap.add_argument("--base", default=str(BASE_DIR))
    ap.add_argument("--once", action="store_true",
                    help="scan existing files once and exit (no watchdog needed)")
    args = ap.parse_args()

    setup_logging()
    watch_dir, base = Path(args.watch_dir), Path(args.base)
    log.info("startup: watch=%s base=%s", watch_dir, base)

    scan(watch_dir, base)
    if args.once:
        return
    watch(watch_dir, base)


if __name__ == "__main__":
    main()
