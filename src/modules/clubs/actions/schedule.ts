"use server";

import { and, eq, gt, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { facility, facilityBooking, facilityPriceRule, user } from "@/db/schema";
import { formValues, invalid, type ActionState } from "@/lib/action-state";
import { formatMoney } from "@/lib/utils";

import { bookingSchema, cancelBookingSchema, idOnly } from "../lib/forms";
import { quoteBooking } from "../lib/pricing";
import { minuteToTime, zonedToUtc } from "../lib/zoned-time";
import { conflictMessage, guardClubWrite, revalidateClub } from "./shared";

// Court / field rentals made at the front desk. The price is always computed
// here from the facility's dynamic pricing (never taken from the form), and
// double-booking is refused by the database (FacilityBooking_no_overlap and
// the rental-vs-session trigger), so two desks booking the same slot at the
// same moment can't both succeed.

const SECTION = "/schedule";

export async function createBooking(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const guard = await guardClubWrite(formData, "MANAGE_SCHEDULE");
  if ("state" in guard) return guard.state;
  const { access } = guard;
  const values = formValues(formData);
  const parsed = bookingSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error, values);
  const b = parsed.data;
  const fail = (field: string, message: string): ActionState => ({ error: "Check the highlighted fields.", fieldErrors: { [field]: message }, values });

  const [court] = await db
    .select({ id: facility.id, name: facility.name, isActive: facility.isActive, openMinute: facility.openMinute, closeMinute: facility.closeMinute, rate: facility.hourlyRateAmount })
    .from(facility)
    .where(and(eq(facility.id, b.facilityId), eq(facility.clubId, access.club.id)));
  if (!court || !court.isActive) return fail("facilityId", "Pick an active facility");
  if (b.startTime < court.openMinute || b.endTime > court.closeMinute) {
    return fail("startTime", `${court.name} is open ${minuteToTime(court.openMinute)}–${minuteToTime(court.closeMinute)}`);
  }

  const startsAt = zonedToUtc(b.date, b.startTime, access.club.timezone);
  const endsAt = zonedToUtc(b.date, b.endTime, access.club.timezone);
  if (!startsAt || !endsAt) return fail("startTime", "That time doesn't exist on that date (clock change)");
  if (endsAt.getTime() <= Date.now()) return fail("date", "That booking would already be over");

  let customerId: string | null = null;
  let customerName = b.customerName;
  if (b.customerEmail) {
    const [customer] = await db.select({ id: user.id, name: user.name }).from(user).where(and(eq(user.email, b.customerEmail), isNull(user.deletedAt)));
    if (!customer) return fail("customerEmail", "No nexport account uses that email. Leave it blank and enter a name for a walk-in.");
    customerId = customer.id;
    customerName ??= customer.name;
  }

  const rules = await db
    .select({ dayOfWeek: facilityPriceRule.dayOfWeek, startMinute: facilityPriceRule.startMinute, endMinute: facilityPriceRule.endMinute, tier: facilityPriceRule.tier, hourlyRateAmount: facilityPriceRule.hourlyRateAmount })
    .from(facilityPriceRule)
    .where(eq(facilityPriceRule.facilityId, court.id));
  const quote = quoteBooking({ startsAt, endsAt, timeZone: access.club.timezone, standardRate: court.rate, rules });

  try {
    await db.insert(facilityBooking).values({
      clubId: access.club.id,
      facilityId: court.id,
      customerId,
      customerName,
      bookedById: access.user.id,
      startsAt,
      endsAt,
      priceAmount: quote.total,
      currency: access.club.currency,
      paymentMethod: b.paymentMethod,
      paidAt: b.paymentMethod === "ON_SITE" && b.paidNow ? new Date() : null,
      notes: b.notes,
    });
  } catch (e) {
    const message = conflictMessage(e);
    if (message) return { error: message, fieldErrors: { startTime: message }, values };
    throw e;
  }
  revalidateClub(access, SECTION);
  revalidateClub(access);
  return { ok: `Booked ${court.name}, ${minuteToTime(b.startTime)}–${minuteToTime(b.endTime)} · ${formatMoney(quote.total, access.club.currency)}.` };
}

export async function markBookingPaid(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const guard = await guardClubWrite(formData, "MANAGE_SCHEDULE");
  if ("state" in guard) return guard.state;
  const { access } = guard;
  const parsed = idOnly("bookingId").safeParse(formValues(formData));
  if (!parsed.success) return { error: "Unknown booking." };
  const updated = await db
    .update(facilityBooking)
    .set({ paidAt: sql`now()` })
    .where(
      and(
        eq(facilityBooking.id, String(parsed.data.bookingId)),
        eq(facilityBooking.clubId, access.club.id),
        eq(facilityBooking.status, "CONFIRMED"),
        eq(facilityBooking.paymentMethod, "ON_SITE"),
        isNull(facilityBooking.paidAt),
      ),
    )
    .returning({ id: facilityBooking.id });
  if (updated.length === 0) return { error: "That booking is already paid or was cancelled." };
  revalidateClub(access, SECTION);
  revalidateClub(access);
  return { ok: "Marked as paid." };
}

export async function cancelBooking(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const guard = await guardClubWrite(formData, "MANAGE_SCHEDULE");
  if ("state" in guard) return guard.state;
  const { access } = guard;
  const values = formValues(formData);
  const parsed = cancelBookingSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error, values);

  const [booking] = await db
    .select({ paymentMethod: facilityBooking.paymentMethod })
    .from(facilityBooking)
    .where(and(eq(facilityBooking.id, parsed.data.bookingId), eq(facilityBooking.clubId, access.club.id)));
  if (!booking) return { error: "Unknown booking." };
  // Online payments are refunded through Stripe, which the desk can't do yet.
  if (booking.paymentMethod === "ONLINE") return { error: "Online bookings are cancelled by the customer or through a Stripe refund." };

  const updated = await db
    .update(facilityBooking)
    .set({ status: "CANCELLED", cancelledAt: sql`now()`, cancelledById: access.user.id, cancellationReason: parsed.data.reason })
    .where(
      and(
        eq(facilityBooking.id, parsed.data.bookingId),
        eq(facilityBooking.clubId, access.club.id),
        eq(facilityBooking.status, "CONFIRMED"),
        gt(facilityBooking.endsAt, sql`now()`),
      ),
    )
    .returning({ id: facilityBooking.id });
  if (updated.length === 0) return { error: "Only upcoming, confirmed bookings can be cancelled." };
  revalidateClub(access, SECTION);
  revalidateClub(access);
  return { ok: "Booking cancelled; the slot is free again." };
}
