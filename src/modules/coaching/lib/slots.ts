import { addDays, isoDowOf, zonedParts, zonedToUtc } from "@/modules/clubs/lib/zoned-time";

// Open slots on a coach's public booking page. A slot is offered when:
//   * it lies inside one of the coach's weekly availability windows (in the
//     club's time zone), on the coach's session-length grid;
//   * it starts after the minimum notice and within the advance limit;
//   * the coach has nothing else then (any club);
//   * at least one facility is open and free then: the window's preferred
//     facility, or any active facility of that club.
// The database guards still have the last word when the slot is booked.

export type Interval = { start: number; end: number };

export type SlotWindow = {
  clubId: string;
  timeZone: string;
  facilityId: string | null;
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
};

export type SlotFacility = { id: string; clubId: string; openMinute: number; closeMinute: number };

export type Slot = { startsAt: Date; endsAt: Date; clubId: string; facilityIds: string[] };

const overlaps = (list: Interval[] | undefined, start: number, end: number) => !!list?.some((b) => b.start < end && b.end > start);

export function openSlots(input: {
  windows: SlotWindow[];
  facilities: SlotFacility[];
  sessionMinutes: number;
  now: Date;
  minNoticeHours: number;
  maxAdvanceDays: number;
  coachBusy: Interval[];
  facilityBusy: Map<string, Interval[]>;
}): Slot[] {
  const { sessionMinutes: len, now } = input;
  const earliest = now.getTime() + input.minNoticeHours * 3_600_000;
  const latest = now.getTime() + input.maxAdvanceDays * 86_400_000;
  const slots: Slot[] = [];
  const seen = new Set<string>();

  for (const w of input.windows) {
    const today = zonedParts(now, w.timeZone).dateKey;
    const candidates = input.facilities.filter((f) => f.clubId === w.clubId && (w.facilityId === null || f.id === w.facilityId));
    for (let day = 0; day <= input.maxAdvanceDays; day++) {
      const dateKey = addDays(today, day);
      if (isoDowOf(dateKey) !== w.dayOfWeek) continue;
      for (let m = w.startMinute; m + len <= w.endMinute; m += len) {
        const startsAt = zonedToUtc(dateKey, m, w.timeZone);
        const endsAt = zonedToUtc(dateKey, m + len, w.timeZone);
        if (!startsAt || !endsAt) continue;
        const start = startsAt.getTime();
        const end = endsAt.getTime();
        if (start < earliest || start > latest || overlaps(input.coachBusy, start, end)) continue;
        const free = candidates
          .filter((f) => m >= f.openMinute && m + len <= f.closeMinute && !overlaps(input.facilityBusy.get(f.id), start, end))
          .map((f) => f.id);
        const key = `${start}`;
        if (free.length === 0 || seen.has(key)) continue;
        seen.add(key);
        slots.push({ startsAt, endsAt, clubId: w.clubId, facilityIds: free });
      }
    }
  }
  return slots.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}
