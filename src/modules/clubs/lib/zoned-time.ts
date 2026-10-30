// Wall-clock time in a club's time zone (IANA, e.g. "Europe/Madrid").
// Clubs think in local time ("Mondays 18:00–22:00 are peak"); the database
// stores instants. These helpers convert between the two with Intl only, and
// handle daylight-saving changes: a local time that doesn't exist (the hour
// skipped in spring) is reported instead of being silently shifted.

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

const weekdays: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** ISO weekday: 1 = Monday … 7 = Sunday. */
  isoDow: number;
  /** Minutes after local midnight. */
  minuteOfDay: number;
  /** "YYYY-MM-DD" */
  dateKey: string;
};

export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts: Record<string, string> = {};
  for (const p of formatter(timeZone).formatToParts(instant)) parts[p.type] = p.value;
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  return {
    year,
    month,
    day,
    hour,
    minute,
    second: Number(parts.second),
    isoDow: weekdays[parts.weekday ?? ""] ?? 1,
    minuteOfDay: hour * 60 + minute,
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

/** How far the zone's wall clock is ahead of UTC at this instant, in ms. */
function offsetMs(instant: Date, timeZone: string) {
  const p = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The instant at which the wall clock in `timeZone` shows `dateKey` at
 * `minuteOfDay` (1440 = midnight at the end of that day), or null if that
 * local time doesn't exist (skipped by a daylight-saving change).
 */
export function zonedToUtc(dateKey: string, minuteOfDay: number, timeZone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match || !Number.isInteger(minuteOfDay) || minuteOfDay < 0 || minuteOfDay > 1440) return null;
  const naive = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, minuteOfDay);
  // Two passes: the offset at the first guess may differ from the offset at
  // the answer when a clock change falls between them.
  let guess = naive - offsetMs(new Date(naive), timeZone);
  const second = naive - offsetMs(new Date(guess), timeZone);
  if (second !== guess) guess = second;

  const result = new Date(guess);
  // Round-trip check catches nonexistent local times (and invalid dates like 02-30).
  // 1440 is compared as 00:00 of the next day.
  const back = zonedParts(result, timeZone);
  const expected = minuteOfDay === 1440 ? { dateKey: addDays(dateKey, 1), minute: 0 } : { dateKey, minute: minuteOfDay };
  return back.dateKey === expected.dateKey && back.minuteOfDay === expected.minute ? result : null;
}

/** "YYYY-MM-DD" of the day after `dateKey` (calendar arithmetic, no zone). */
export function addDays(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

/** ISO weekday (1 = Monday) of a calendar date. */
export function isoDowOf(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dow = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
  return dow === 0 ? 7 : dow;
}

/** 1080 → "18:00", 1440 → "24:00". */
export function minuteToTime(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

/** "18:00" → 1080; "24:00" → 1440 (only as an end time). Null if malformed. */
export function timeToMinute(value: string): number | null {
  const match = /^([01]\d|2[0-4]):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  const minute = Number(match[1]) * 60 + Number(match[2]);
  return minute <= 1440 ? minute : null;
}

/** Whether a string is a time zone Intl knows. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone });
    return true;
  } catch {
    return false;
  }
}
