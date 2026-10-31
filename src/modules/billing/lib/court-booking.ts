import { z } from "zod";

import { idSchema } from "@/lib/validation";
import { timeToMinute, zonedToUtc } from "@/modules/clubs/lib/zoned-time";

// Online court bookings: the request a customer sends, and the rules a
// booking window must meet. Pure, so they're unit-tested.

export const MIN_NOTICE_MINUTES = 30;
export const MAX_ADVANCE_DAYS = 30;
export const MIN_MINUTES = 30;
export const MAX_MINUTES = 4 * 60;
/** Stripe's minimum charge is about €0.50 / $0.50; below that a PaymentIntent is refused. */
export const MIN_ONLINE_AMOUNT = 50;
/** Unpaid holds one customer may have at once (each blocks a court). */
export const MAX_OPEN_HOLDS = 2;

const time = (label: string) =>
  z.string().transform((value, ctx) => {
    const minute = timeToMinute(value);
    if (minute === null || minute % 15 !== 0) {
      ctx.addIssue({ code: "custom", message: `Enter ${label} as HH:MM in 15-minute steps` });
      return z.NEVER;
    }
    return minute;
  });

export const courtBookingSchema = z
  .object({
    facilityId: idSchema,
    date: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Pick a date"),
    startTime: time("the start time"),
    endTime: time("the end time"),
  })
  .refine((b) => b.endTime > b.startTime, { path: ["endTime"], message: "End must be after start" })
  .refine((b) => b.endTime - b.startTime >= MIN_MINUTES && b.endTime - b.startTime <= MAX_MINUTES, {
    path: ["endTime"],
    message: `Book from ${MIN_MINUTES} minutes to ${MAX_MINUTES / 60} hours`,
  });

export type CourtBookingRequest = z.infer<typeof courtBookingSchema>;

export type WindowCheck = { ok: true; startsAt: Date; endsAt: Date } | { ok: false; field: "date" | "startTime" | "endTime"; message: string };

/**
 * Turns a local booking request into instants and checks it against the
 * facility's opening hours, the clock, and the booking horizon.
 */
export function checkWindow(
  req: Pick<CourtBookingRequest, "date" | "startTime" | "endTime">,
  facility: { openMinute: number; closeMinute: number; name: string },
  timeZone: string,
  now: Date = new Date(),
): WindowCheck {
  if (req.startTime < facility.openMinute || req.endTime > facility.closeMinute) {
    const hh = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    return { ok: false, field: "startTime", message: `${facility.name} is open ${hh(facility.openMinute)}–${hh(facility.closeMinute)}` };
  }
  const startsAt = zonedToUtc(req.date, req.startTime, timeZone);
  const endsAt = zonedToUtc(req.date, req.endTime, timeZone);
  if (!startsAt || !endsAt) return { ok: false, field: "startTime", message: "That time doesn't exist on that date (clock change)" };
  if (startsAt.getTime() < now.getTime() + MIN_NOTICE_MINUTES * 60_000) {
    return { ok: false, field: "date", message: `Book at least ${MIN_NOTICE_MINUTES} minutes ahead` };
  }
  if (startsAt.getTime() > now.getTime() + MAX_ADVANCE_DAYS * 86_400_000) {
    return { ok: false, field: "date", message: `Bookings open ${MAX_ADVANCE_DAYS} days ahead` };
  }
  return { ok: true, startsAt, endsAt };
}

/** Platform fee in minor units: basis points of the amount, never more than the amount. */
export function platformFee(amount: number, feeBps: number): number {
  if (!Number.isInteger(amount) || amount < 0 || !Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10_000) throw new RangeError("Invalid fee input");
  return Math.min(amount, Math.round((amount * feeBps) / 10_000));
}
