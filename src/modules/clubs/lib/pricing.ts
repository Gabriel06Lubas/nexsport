import type { PriceTier } from "@/db/schema/enums";

import { zonedParts } from "./zoned-time";

// Dynamic court pricing. A facility has a standard hourly rate; price rules
// override it in weekday time windows (club time zone), tagged PEAK or
// OFF_PEAK. A booking that spans windows is charged per 15-minute slot at
// the rate of the window the slot starts in, so 17:30–19:00 with peak from
// 18:00 is 30 minutes standard + 60 minutes peak.

export const SLOT_MINUTES = 15;

export type PriceRule = {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  tier: PriceTier;
  hourlyRateAmount: number;
};

export type QuoteLine = { tier: PriceTier | "STANDARD"; hourlyRate: number; minutes: number; amount: number };
export type Quote = { total: number; lines: QuoteLine[] };

export function ruleAt(rules: readonly PriceRule[], isoDow: number, minuteOfDay: number): PriceRule | null {
  return rules.find((r) => r.dayOfWeek === isoDow && minuteOfDay >= r.startMinute && minuteOfDay < r.endMinute) ?? null;
}

export function quoteBooking(input: {
  startsAt: Date;
  endsAt: Date;
  timeZone: string;
  /** Facility.hourlyRateAmount; null charges uncovered time at 0. */
  standardRate: number | null;
  rules: readonly PriceRule[];
}): Quote {
  const { startsAt, endsAt, timeZone, rules } = input;
  const slotMs = SLOT_MINUTES * 60_000;
  if (endsAt.getTime() <= startsAt.getTime() || (endsAt.getTime() - startsAt.getTime()) % slotMs !== 0) {
    throw new RangeError(`A booking must be a positive multiple of ${SLOT_MINUTES} minutes`);
  }

  const byRate = new Map<string, QuoteLine>();
  for (let t = startsAt.getTime(); t < endsAt.getTime(); t += slotMs) {
    const local = zonedParts(new Date(t), timeZone);
    const rule = ruleAt(rules, local.isoDow, local.minuteOfDay);
    const tier = rule?.tier ?? "STANDARD";
    const hourlyRate = rule?.hourlyRateAmount ?? input.standardRate ?? 0;
    const key = `${tier}:${hourlyRate}`;
    const line = byRate.get(key) ?? { tier, hourlyRate, minutes: 0, amount: 0 };
    line.minutes += SLOT_MINUTES;
    byRate.set(key, line);
  }

  const lines = [...byRate.values()].map((line) => ({ ...line, amount: Math.round((line.hourlyRate * line.minutes) / 60) }));
  return { total: lines.reduce((sum, l) => sum + l.amount, 0), lines };
}
