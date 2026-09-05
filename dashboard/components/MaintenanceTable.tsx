"use client";

import { useMemo, useState } from "react";
import {
  DUE_SOON_MI,
  mi,
  partLookupUrl,
  type ItemDue,
  type MaintenanceItem,
  type PartRef,
} from "@/lib/maintenance";

const DIY_LABEL: Record<MaintenanceItem["diy"], string> = {
  easy: "DIY · easy",
  moderate: "DIY · tools",
  shop: "Shop",
};

function Tag({ item }: { item: MaintenanceItem }) {
  const ford = item.source === "ford";
  return (
    <span
      className={`tag ${ford ? "tag-ford" : "tag-rec"}`}
      title={
        ford
          ? "On Ford's scheduled-maintenance list"
          : "Not on Ford's list — practical EV item"
      }
    >
      {ford ? "Ford" : "Recommended"}
    </span>
  );
}

function Diy({ item }: { item: MaintenanceItem }) {
  return <span className={`tag diy-${item.diy}`}>{DIY_LABEL[item.diy]}</span>;
}

/**
 * A part number and its provenance. Anything not corroborated by a dealer
 * catalog renders muted with the caveat attached, so an unverified number
 * can't be mistaken for a confirmed one at a glance.
 */
function Part({ part }: { part: PartRef }) {
  const unsure = part.confidence === "verify";
  return (
    <div className="part">
      <span className="part-label">{part.label}</span>
      <a
        className={`part-no${unsure ? " part-unsure" : ""}`}
        href={partLookupUrl(part)}
        target="_blank"
        rel="noopener noreferrer"
        title={`Source: ${part.via}\nClick to search for this part`}
      >
        {part.number}
        {unsure && <span className="part-flag" title={`Source: ${part.via}`}> ?</span>}
      </a>
    </div>
  );
}

function Parts({ parts }: { parts: PartRef[] }) {
  if (parts.length === 0) return <span className="dim">no parts</span>;
  return (
    <div className="parts">
      {parts.map((p) => (
        <Part key={p.label + p.number} part={p} />
      ))}
    </div>
  );
}

function Eta({ days }: { days: number | null }) {
  if (days == null) return <span className="dim">—</span>;
  if (days <= 0) return <span className="warn-text">now</span>;
  if (days < 45) return <>{`~${days} days`}</>;
  const months = days / 30.44;
  if (months < 18) return <>{`~${Math.round(months)} months`}</>;
  return <>{`~${(days / 365.25).toFixed(1)} years`}</>;
}

function ScheduledRow({ due }: { due: ItemDue }) {
  const { item, nextDueMi, milesRemaining, etaDays, dueSoon } = due;
  return (
    <tr className={dueSoon ? "row-due" : undefined}>
      <td className="cell-name">
        <div className="name">{item.name}</div>
        <div className="tags">
          <Tag item={item} />
          <Diy item={item} />
        </div>
      </td>
      <td>every {mi(item.intervalMi as number)}</td>
      <td>{mi(nextDueMi)}</td>
      <td className={dueSoon ? "warn-text" : undefined}>
        {milesRemaining.toLocaleString("en-US")}
      </td>
      <td>
        <Eta days={etaDays} />
      </td>
      <td className="cell-parts">
        <Parts parts={item.parts} />
      </td>
      <td className="cell-notes">{item.notes}</td>
    </tr>
  );
}

export default function MaintenanceTable({
  due,
  partsOnly,
  timeBased,
}: {
  due: ItemDue[];
  partsOnly: MaintenanceItem[];
  timeBased: MaintenanceItem[];
}) {
  const [diyOnly, setDiyOnly] = useState(false);

  const shownDue = useMemo(
    () => (diyOnly ? due.filter((d) => d.item.diy !== "shop") : due),
    [due, diyOnly]
  );
  const shownParts = useMemo(
    () => (diyOnly ? partsOnly.filter((i) => i.diy !== "shop") : partsOnly),
    [partsOnly, diyOnly]
  );
  const shownTime = useMemo(
    () => (diyOnly ? timeBased.filter((i) => i.diy !== "shop") : timeBased),
    [timeBased, diyOnly]
  );

  return (
    <>
      <label className="toggle">
        <input
          type="checkbox"
          checked={diyOnly}
          onChange={(e) => setDiyOnly(e.target.checked)}
        />
        Hide shop-only jobs
      </label>

      <div className="table-wrap tall">
        <table className="maint">
          <thead>
            <tr>
              <th>Item</th>
              <th>Interval</th>
              <th>Next due</th>
              <th>Miles away</th>
              <th>Est.</th>
              <th>Part</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {shownDue.map((d) => (
              <ScheduledRow key={d.item.id} due={d} />
            ))}

            {shownParts.length > 0 && (
              <tr className="group-row">
                <td colSpan={7}>
                  Replaced on condition — no mileage interval to track
                </td>
              </tr>
            )}
            {shownParts.map((item) => (
              <tr key={item.id}>
                <td className="cell-name">
                  <div className="name">{item.name}</div>
                  <div className="tags">
                    <Tag item={item} />
                    <Diy item={item} />
                  </div>
                </td>
                <td className="dim">as needed</td>
                <td className="dim">—</td>
                <td className="dim">—</td>
                <td className="dim">—</td>
                <td className="cell-parts">
                  <Parts parts={item.parts} />
                </td>
                <td className="cell-notes">
                  {item.notes}
                  {item.crossLink && (
                    <>
                      {" "}
                      <a className="xlink" href={item.crossLink.href}>
                        {item.crossLink.label}
                      </a>
                    </>
                  )}
                </td>
              </tr>
            ))}

            {shownTime.length > 0 && (
              <tr className="group-row">
                <td colSpan={7}>
                  Time-based — not tracked here, since nothing in trips.db records
                  when the car entered service
                </td>
              </tr>
            )}
            {shownTime.map((item) => (
              <tr key={item.id} className="row-untracked">
                <td className="cell-name">
                  <div className="name">{item.name}</div>
                  <div className="tags">
                    <Tag item={item} />
                    <Diy item={item} />
                  </div>
                </td>
                <td>{item.timeInterval}</td>
                <td className="dim">—</td>
                <td className="dim">—</td>
                <td className="dim">—</td>
                <td className="cell-parts">
                  <Parts parts={item.parts} />
                </td>
                <td className="cell-notes">{item.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="statline">
        <span>
          Flagged at <b>{mi(DUE_SOON_MI)}</b> out
        </span>
        <span>
          <span className="part-flag">?</span> = part number not confirmed against a
          dealer catalog — hover for the source, and check it against your VIN
        </span>
      </div>
    </>
  );
}
