// Routine-maintenance schedule for the 2023 Mustang Mach-E AWD ER.
//
// Static data + pure functions only — safe to import from client components.
// Nothing here reads the DB; the page passes in the current odometer.
//
// SOURCING. Part numbers cost real money when they're wrong, so every number
// carries the confidence it was gathered at:
//   "confirmed" — agreed across independent sources, at least one of which is
//                 a Ford dealer parts catalog or ford.com itself.
//   "verify"    — plausible and corroborated, but only from forums/retailers,
//                 or the naming varies between sources. Shown muted, with the
//                 caveat visible in the UI.
// Ford's own maintenance PDF (vdm.ford.com) 404s and fordservicecontent.com
// would not serve, so intervals below come from corroborated secondary
// sources. Treat this page as a shopping aid, not as the warranty schedule:
// FordPass and the owner's manual remain authoritative, and fitment can vary
// with build date even within a model year. Every part links to a search so
// the number gets checked against the VIN before anything is ordered.

export type Confidence = "confirmed" | "verify";

export type PartRef = {
  label: string;
  /** OEM part number, or a spec/size where that's what you actually order by. */
  number: string;
  confidence: Confidence;
  /** Where the number came from, shown as a tooltip. */
  via: string;
};

export type ItemGroup =
  /** Mileage interval known — gets a computed "next due". */
  | "scheduled"
  /** Replace on condition, not on a schedule. Listed for the part numbers. */
  | "parts"
  /** Real interval, but measured in years — not tracked (see below). */
  | "time-based";

export type MaintenanceItem = {
  id: string;
  name: string;
  group: ItemGroup;
  /** "ford" = on Ford's schedule. "recommended" = practical EV item that isn't. */
  source: "ford" | "recommended";
  diy: "easy" | "moderate" | "shop";
  /** Mileage between services. null for non-"scheduled" groups. */
  intervalMi: number | null;
  /** First service lands here, then every intervalMi after. Defaults to intervalMi. */
  firstAtMi?: number;
  /** Stated interval for "time-based" items, e.g. "every 3 years". */
  timeInterval?: string;
  notes: string;
  parts: PartRef[];
  /** Anchor on the trips page where this item already has live data. */
  crossLink?: { href: string; label: string };
};

/** Flagged as due soon inside this many miles. */
export const DUE_SOON_MI = 1000;

export const SCHEDULE: MaintenanceItem[] = [
  {
    id: "tire-rotation",
    name: "Tire rotation",
    group: "scheduled",
    source: "ford",
    diy: "moderate",
    intervalMi: 10_000,
    notes:
      "The item most worth staying on top of on this car: an ER AWD is heavy and " +
      "makes torque instantly, so fronts wear noticeably faster than on a comparable " +
      "ICE car. Needs a jack, stands and a torque wrench — check the manual for the " +
      "lug spec rather than guessing.",
    parts: [],
  },
  {
    id: "cabin-air-filter",
    name: "Cabin air filter",
    group: "scheduled",
    source: "ford",
    diy: "easy",
    intervalMi: 20_000,
    notes:
      "Straightforward DIY, but the Mach-E's filter is not behind the glovebox the " +
      "way most Fords are — worth reading a how-to before you start. The premium " +
      "carbon version is a direct swap if you want odor filtering.",
    parts: [
      {
        label: "Filter (standard)",
        number: "LX6Z-19N619-CA",
        confidence: "confirmed",
        via: "Ford dealer parts catalogs (Lakeland, Levittown); supersedes Motorcraft FP-89",
      },
      {
        label: "Filter (carbon/odor)",
        number: "MU2Z-19N619-E",
        confidence: "verify",
        via: "MachEforum premium-filter thread; retailer listings",
      },
    ],
  },
  {
    id: "brake-inspection",
    name: "Brake inspection",
    group: "scheduled",
    source: "ford",
    diy: "moderate",
    intervalMi: 20_000,
    firstAtMi: 40_000,
    notes:
      "Pads, rotors, lines and hoses. Regen means the friction material will likely " +
      "outlast the car, so this is really a corrosion check, not a wear check.",
    parts: [],
  },
  {
    id: "rear-caliper-service",
    name: "Rear caliper clean & lubricate",
    group: "scheduled",
    source: "recommended",
    diy: "moderate",
    intervalMi: 10_000,
    notes:
      "Not on Ford's schedule, and the one entry here worth arguing for. Fronts are " +
      "Brembo fixed four-piston units with no slide pins to seize. The rears are " +
      "conventional sliding calipers, and on an EV they do so little work that pins " +
      "and pad slides corrode in place — the classic low-brake-use EV failure. " +
      "Easiest done with the wheels already off for rotation. No official interval " +
      "exists; pairing it with rotation is a judgement call, not a Ford figure.",
    parts: [
      {
        label: "Silicone caliper grease",
        number: "Motorcraft XG-3-A",
        confidence: "verify",
        via: "Ford chemical catalog listings; any high-temp silicone caliper grease works",
      },
    ],
  },

  // ---- Condition-based: no interval to compute, listed for the part numbers ----
  {
    id: "wiper-blades",
    name: "Wiper blades",
    group: "parts",
    source: "recommended",
    diy: "easy",
    intervalMi: null,
    notes:
      "Replaced on condition, typically annually. Ordered by size rather than part " +
      "number. The Mach-E has no rear wiper, so ignore the three-blade kits sold for it.",
    parts: [
      {
        label: "Driver side",
        number: '24"',
        confidence: "confirmed",
        via: "Agreed across wiper-fitment catalogs (Otto, WindshieldWipers, Windy)",
      },
      {
        label: "Passenger side",
        number: '20"',
        confidence: "confirmed",
        via: "Agreed across wiper-fitment catalogs (Otto, WindshieldWipers, Windy)",
      },
    ],
  },
  {
    id: "key-fob-battery",
    name: "Key fob battery",
    group: "parts",
    source: "recommended",
    diy: "easy",
    intervalMi: null,
    notes:
      "Every few years, per fob — buy a pack and do both at once. A weak fob often " +
      "shows up as intermittent phone-as-a-key handoff before it fully dies.",
    parts: [
      {
        label: "Coin cell (per fob)",
        number: "CR2450 (3V lithium)",
        confidence: "confirmed",
        via: "ford.com Mach-E key fob support page",
      },
    ],
  },
  {
    id: "v12-battery",
    name: "12V battery",
    group: "parts",
    source: "recommended",
    diy: "moderate",
    intervalMi: null,
    notes:
      "Replaced on condition, not mileage — and you already have better data on this " +
      "one than a schedule could give you. The trips page tracks its age, resting " +
      "voltage and quiescent drain; a sustained rise in drain is the leading sign it " +
      "or a module is on the way out.",
    parts: [
      {
        label: "AGM battery",
        number: "Group H3 AGM — Motorcraft BAGM-H3",
        confidence: "verify",
        via: "MachEforum 12V FAQ; naming varies (BAGMH3 / BHAGM-H3) between listings",
      },
    ],
    crossLink: { href: "/#v12", label: "See live 12V data →" },
  },

  // ---- Time-based: real, but not tracked here (no in-service date) ----
  {
    id: "brake-fluid",
    name: "Brake fluid",
    group: "time-based",
    source: "ford",
    diy: "shop",
    intervalMi: null,
    timeInterval: "every 3 years",
    notes:
      "Hygroscopic, so it degrades on a clock regardless of how little you use the " +
      "friction brakes — which on this car is very little. Ford calls for dealer " +
      "equipment.",
    parts: [
      {
        label: "Fluid",
        number: "DOT 4 LV — Motorcraft PM-20",
        confidence: "verify",
        via: "Ford chemical catalog listings",
      },
    ],
  },
  {
    id: "coolant",
    name: "Coolant (HV battery & drive loops)",
    group: "time-based",
    source: "ford",
    diy: "shop",
    intervalMi: null,
    timeInterval: "long-life — high mileage/age only",
    notes:
      "Multiple separate loops. Long-life fill; inspection is part of the routine " +
      "multi-point check rather than something you do on a mileage trigger.",
    parts: [
      {
        label: "Coolant",
        number: "Orange prediluted, Ford spec WSS-M97B44-D2",
        confidence: "verify",
        via: "motorcraft.com product page; VC-3DIL-B superseded",
      },
    ],
  },
];

/**
 * Next odometer reading at which `item` comes due.
 *
 * With no service history there is nothing to compare against, so this is
 * purely "the next interval boundary ahead of you" — it cannot know whether
 * the last one was actually done, and so can never report overdue. An item
 * sitting exactly on a boundary rolls forward to the next one.
 */
export function nextDueMi(item: MaintenanceItem, odometer: number): number | null {
  if (item.intervalMi == null) return null;
  const first = item.firstAtMi ?? item.intervalMi;
  if (odometer < first) return first;
  const elapsed = odometer - first;
  return first + (Math.floor(elapsed / item.intervalMi) + 1) * item.intervalMi;
}

export type ItemDue = {
  item: MaintenanceItem;
  nextDueMi: number;
  milesRemaining: number;
  /** Projected days until due at the recent driving pace; null if pace unknown. */
  etaDays: number | null;
  dueSoon: boolean;
};

export function computeDue(
  items: MaintenanceItem[],
  odometer: number,
  milesPerDay: number | null
): ItemDue[] {
  return items
    .filter((i) => i.group === "scheduled")
    .map((item) => {
      const due = nextDueMi(item, odometer) as number;
      // Odometer readings carry a decimal; a fractional mile of headroom is
      // noise, so round once here and let every consumer show a whole number.
      const milesRemaining = Math.round(due - odometer);
      return {
        item,
        nextDueMi: due,
        milesRemaining,
        etaDays:
          milesPerDay && milesPerDay > 0
            ? Math.round(milesRemaining / milesPerDay)
            : null,
        dueSoon: milesRemaining <= DUE_SOON_MI,
      };
    })
    .sort((a, b) => a.milesRemaining - b.milesRemaining);
}

/**
 * Search link for a part number. Derived rather than stored so a link can
 * never drift from the number printed next to it. Deliberately a plain web
 * search: it survives catalogs reorganising, and lets prices be compared.
 */
export function partLookupUrl(part: PartRef): string {
  const q = `"${part.number}" Mustang Mach-E`;
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

/** Human-readable mileage, e.g. 20000 -> "20,000 mi". */
export const mi = (n: number) => `${n.toLocaleString("en-US")} mi`;
