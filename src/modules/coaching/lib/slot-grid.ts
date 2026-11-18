import { minuteToTime, zonedParts } from "@/modules/clubs/lib/zoned-time";

import type { Slot, TakenSlot } from "./slots";

// A coach's public page as a booking grid: the clubs they teach at as
// columns, session start times as rows, one day at a time. Times are local
// to each club. Pure, so it's unit tested.

export type CoachGridClub = { id: string; name: string; timeZone: string };

export type CoachGridCell =
  | { state: "available"; startTime: string; endTime: string; startsAt: string }
  | { state: "booked" }
  | { state: "unavailable" };

export type CoachGrid = {
  /** Days with something to show (open or taken), in order. */
  days: string[];
  /** The first day with an open slot, or the first day. */
  firstOpenDay: string | null;
  columns: CoachGridClub[];
  rowsFor: (day: string) => { time: string; cells: CoachGridCell[] }[];
};

export function buildCoachGrid(input: { open: readonly Slot[]; taken: readonly TakenSlot[]; clubs: readonly CoachGridClub[] }): CoachGrid {
  const clubById = new Map(input.clubs.map((c) => [c.id, c]));
  type Entry = { clubId: string; day: string; minute: number; endMinute: number; startsAt: Date; open: boolean };
  const entries: Entry[] = [];
  const add = (s: { startsAt: Date; endsAt: Date; clubId: string }, open: boolean) => {
    const club = clubById.get(s.clubId);
    if (!club) return;
    const start = zonedParts(s.startsAt, club.timeZone);
    const end = zonedParts(s.endsAt, club.timeZone);
    entries.push({ clubId: s.clubId, day: start.dateKey, minute: start.minuteOfDay, endMinute: end.dateKey === start.dateKey ? end.minuteOfDay : 24 * 60, startsAt: s.startsAt, open });
  };
  input.open.forEach((s) => add(s, true));
  input.taken.forEach((s) => add(s, false));

  const days = [...new Set(entries.map((e) => e.day))].sort();
  const firstOpenDay = entries.filter((e) => e.open).map((e) => e.day).sort()[0] ?? days[0] ?? null;
  const usedClubs = new Set(entries.map((e) => e.clubId));
  const columns = input.clubs.filter((c) => usedClubs.has(c.id));

  return {
    days,
    firstOpenDay,
    columns,
    rowsFor(day) {
      const today = entries.filter((e) => e.day === day);
      const minutes = [...new Set(today.map((e) => e.minute))].sort((a, b) => a - b);
      return minutes.map((minute) => ({
        time: minuteToTime(minute),
        cells: columns.map((club): CoachGridCell => {
          const here = today.filter((e) => e.clubId === club.id && e.minute === minute);
          const open = here.find((e) => e.open);
          if (open) return { state: "available", startTime: minuteToTime(open.minute), endTime: minuteToTime(open.endMinute), startsAt: open.startsAt.toISOString() };
          return here.length > 0 ? { state: "booked" } : { state: "unavailable" };
        }),
      }));
    },
  };
}
