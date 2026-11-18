import { quoteBooking, type PriceRule } from "@/modules/clubs/lib/pricing";
import { minuteToTime, zonedToUtc } from "@/modules/clubs/lib/zoned-time";

import { checkWindow, MIN_ONLINE_AMOUNT } from "./court-booking";

// The court availability grid: courts as columns, start times as rows. Pure
// (the page passes in what the database says), so it's unit tested. The grid
// is only a picture of the moment the page was rendered: the booking action
// and the database's exclusion constraint decide whether a slot is really free.

/** First and last start time shown (club local time), and the row step. */
export const GRID_FIRST_START = 8 * 60;
export const GRID_LAST_START = 22 * 60 + 30;
export const GRID_STEP = 30;

/** Booking lengths the grid offers; the default is one hour. */
export const GRID_DURATIONS = [60, 90, 120] as const;
export type GridDuration = (typeof GRID_DURATIONS)[number];
export const DEFAULT_GRID_DURATION: GridDuration = 60;

export function parseGridDuration(value: unknown): GridDuration {
  const n = Number(value);
  return (GRID_DURATIONS as readonly number[]).includes(n) ? (n as GridDuration) : DEFAULT_GRID_DURATION;
}

export type GridCourt = {
  id: string;
  name: string;
  openMinute: number;
  closeMinute: number;
  /** Facility.hourlyRateAmount (minor units); null: only price rules apply. */
  rate: number | null;
  rules: readonly PriceRule[];
};

/** Anything that occupies a court: rentals (confirmed or held) and coached sessions. */
export type BusyInterval = { facilityId: string; startsAt: Date; endsAt: Date };

export type GridCell =
  | { state: "available"; startTime: string; endTime: string; amount: number }
  | { state: "booked" }
  | {
      state: "unavailable";
      /** closed: outside opening hours · past: too soon or too far ahead · no-fit: the length runs into a booking or closing · desk: can't be paid online */
      reason: "closed" | "past" | "no-fit" | "desk";
    };

export type GridRow = { time: string; cells: GridCell[] };

const overlaps = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) => aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();

export function gridStartMinutes(): number[] {
  const out: number[] = [];
  for (let m = GRID_FIRST_START; m <= GRID_LAST_START; m += GRID_STEP) out.push(m);
  return out;
}

/**
 * One row per start time, one cell per court (in the order given):
 *   booked      the row's own half hour is taken;
 *   available   a booking of `duration` starting here fits (opening hours,
 *               notice, nothing in the way) and can be paid online, priced
 *               with the club's peak / off-peak rules;
 *   unavailable otherwise, with the reason.
 */
export function buildCourtGrid(input: {
  date: string;
  timeZone: string;
  duration: GridDuration;
  courts: readonly GridCourt[];
  busy: readonly BusyInterval[];
  now?: Date;
}): GridRow[] {
  const { date, timeZone, duration, courts, busy, now = new Date() } = input;
  const busyByCourt = new Map<string, BusyInterval[]>();
  for (const b of busy) busyByCourt.set(b.facilityId, [...(busyByCourt.get(b.facilityId) ?? []), b]);

  return gridStartMinutes().map((start) => ({
    time: minuteToTime(start),
    cells: courts.map((court): GridCell => {
      const taken = busyByCourt.get(court.id) ?? [];
      const rowStart = zonedToUtc(date, start, timeZone);
      const rowEnd = zonedToUtc(date, start + GRID_STEP, timeZone);
      if (!rowStart || !rowEnd) return { state: "unavailable", reason: "closed" }; // a clock change skips this time
      if (taken.some((b) => overlaps(rowStart, rowEnd, b.startsAt, b.endsAt))) return { state: "booked" };
      if (start < court.openMinute || start >= court.closeMinute) return { state: "unavailable", reason: "closed" };

      const end = start + duration;
      if (end > court.closeMinute) return { state: "unavailable", reason: "no-fit" };
      const window = checkWindow({ date, startTime: start, endTime: end }, court, timeZone, now);
      if (!window.ok)
        return {
          state: "unavailable",
          reason: window.field === "date" ? "past" : "closed",
        };
      if (taken.some((b) => overlaps(window.startsAt, window.endsAt, b.startsAt, b.endsAt))) return { state: "unavailable", reason: "no-fit" };

      const amount = quoteBooking({
        startsAt: window.startsAt,
        endsAt: window.endsAt,
        timeZone,
        standardRate: court.rate,
        rules: court.rules,
      }).total;
      if (amount < MIN_ONLINE_AMOUNT) return { state: "unavailable", reason: "desk" };
      return {
        state: "available",
        startTime: minuteToTime(start),
        endTime: minuteToTime(end),
        amount,
      };
    }),
  }));
}

/** Locale for prices in the club's country ("24,00 €" in Portugal or Spain, "£24.00" in the UK). */
export function moneyLocale(country: string): string {
  const locales: Record<string, string> = {
    PT: "pt-PT",
    ES: "es-ES",
    FR: "fr-FR",
    DE: "de-DE",
    IT: "it-IT",
    NL: "nl-NL",
    BE: "fr-BE",
    GB: "en-GB",
    IE: "en-IE",
    US: "en-US",
  };
  return locales[country.toUpperCase()] ?? "en-IE";
}
