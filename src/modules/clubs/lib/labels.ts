import type { EquipmentCondition, FacilityType, SurfaceType } from "@/db/schema/enums";

// Human labels for enum values shown in the club dashboard.

export const facilityTypeLabels: Record<FacilityType, string> = {
  FOOTBALL_PITCH: "Football pitch",
  FUTSAL_COURT: "Futsal court",
  PADEL_COURT: "Padel court",
  TENNIS_COURT: "Tennis court",
  BASKETBALL_COURT: "Basketball court",
  GYM: "Gym",
  STUDIO: "Studio",
  POOL: "Pool",
  TRACK: "Track",
  MULTIPURPOSE: "Multipurpose",
  OTHER: "Other",
};

export const surfaceLabels: Record<SurfaceType, string> = {
  NATURAL_GRASS: "Natural grass",
  ARTIFICIAL_TURF: "Artificial turf",
  CLAY: "Clay",
  HARD_COURT: "Hard court",
  SYNTHETIC: "Synthetic / glass court",
  WOOD: "Wood",
  RUBBER: "Rubber",
  OTHER: "Other",
};

export const conditionLabels: Record<EquipmentCondition, string> = {
  NEW: "New",
  GOOD: "Good",
  FAIR: "Fair",
  NEEDS_REPAIR: "Needs repair",
  RETIRED: "Retired",
};

export const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** [1,2,3,4,5] → "Mon–Fri"; [1,3,6] → "Mon, Wed, Sat". */
export function formatDays(days: number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  const runs: number[][] = [];
  for (const d of sorted) {
    const run = runs.at(-1);
    if (run && run.at(-1) === d - 1) run.push(d);
    else runs.push([d]);
  }
  return runs
    .map((run) => (run.length >= 3 ? `${dayLabels[run[0]! - 1]}–${dayLabels[run.at(-1)! - 1]}` : run.map((d) => dayLabels[d - 1]).join(", ")))
    .join(", ");
}

export const options = <T extends string>(labels: Record<T, string>) =>
  (Object.entries(labels) as [T, string][]).map(([value, label]) => ({ value, label }));
