import MaintenanceTable from "@/components/MaintenanceTable";
import { PACE_WINDOW_DAYS, loadOdometerState } from "@/lib/db";
import { DUE_SOON_MI, SCHEDULE, computeDue, mi } from "@/lib/maintenance";

export const dynamic = "force-dynamic"; // re-read trips.db on every page load

export const metadata = {
  title: "Maintenance · Mach-E Trips",
};

export default function MaintenancePage() {
  const { odometer, readingAt, milesPerDay } = loadOdometerState();

  const partsOnly = SCHEDULE.filter((i) => i.group === "parts");
  const timeBased = SCHEDULE.filter((i) => i.group === "time-based");
  const due = odometer != null ? computeDue(SCHEDULE, odometer, milesPerDay) : [];
  const dueSoon = due.filter((d) => d.dueSoon);

  return (
    <main>
      <header className="page">
        <h1>🔧 Maintenance</h1>
        <span className="sub">
          2023 Mustang Mach-E AWD ER · intervals, and what to order
        </span>
      </header>

      {odometer == null ? (
        <section>
          <div className="alert bad">
            No odometer readings in trips.db yet, so nothing can be scheduled. The
            reference tables below still list the part numbers.
          </div>
        </section>
      ) : (
        <section>
          <div className="cards">
            <div className="card">
              <div className="label">Odometer</div>
              <div className="value">
                {Math.round(odometer).toLocaleString("en-US")}
              </div>
              <div className="hint">
                {readingAt ? `as of ${readingAt.slice(0, 10)}` : "—"}
              </div>
            </div>
            <div className="card">
              <div className="label">Recent pace</div>
              <div className="value">
                {milesPerDay != null
                  ? `${Math.round(milesPerDay * 7).toLocaleString("en-US")}`
                  : "—"}
              </div>
              <div className="hint">
                {milesPerDay != null
                  ? `mi/week · last ${PACE_WINDOW_DAYS} days`
                  : "not enough readings"}
              </div>
            </div>
            <div className="card">
              <div className="label">Due soon</div>
              <div className={`value ${dueSoon.length ? "warn-text" : ""}`}>
                {dueSoon.length}
              </div>
              <div className="hint">within {mi(DUE_SOON_MI)}</div>
            </div>
          </div>
        </section>
      )}

      {dueSoon.length > 0 && (
        <section>
          <h2>Coming up</h2>
          <div className="panel">
            {dueSoon.map((d) => (
              <div key={d.item.id} className="due-line">
                <b>{d.item.name}</b> at {mi(d.nextDueMi)} —{" "}
                {d.milesRemaining.toLocaleString("en-US")} mi away
                {d.etaDays != null && d.etaDays > 0 && `, roughly ${d.etaDays} days`}
                {d.item.parts.length > 0 && (
                  <span className="dim">
                    {" · "}
                    {d.item.parts.map((p) => p.number).join(", ")}
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2>Schedule</h2>
        <div className="chart-note">
          Sorted by how soon each falls due. Part numbers link to a search — check
          fitment against your VIN before ordering.
        </div>
        <div className="panel">
          <MaintenanceTable
            due={due}
            partsOnly={partsOnly}
            timeBased={timeBased}
          />
        </div>
      </section>

      <section>
        <div className="alert note">
          <b>What this page can&apos;t tell you.</b> There&apos;s no service history
          behind it, so &ldquo;next due&rdquo; is just the next interval boundary
          ahead of the odometer — it doesn&apos;t know whether the last one was
          actually done, and nothing here will ever show as overdue. Ford&apos;s own
          schedule in FordPass remains authoritative for warranty purposes.
        </div>
      </section>
    </main>
  );
}
