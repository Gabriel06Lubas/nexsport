"use server";

import { createId } from "@paralleldrive/cuid2";
import { and, count, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { isBookingConflict } from "@/db/errors";
import { club, facility, facilityBooking, facilityPriceRule, paymentTransaction, stripeAccount } from "@/db/schema";
import { clubOpenToPublicSql } from "@/lib/entitlements";
import { quoteBooking } from "@/modules/clubs/lib/pricing";
import { minuteToTime } from "@/modules/clubs/lib/zoned-time";
import { platformFeeBpsFor } from "@/modules/payments/platform-fee";
import { releaseExpiredHolds } from "@/modules/payments/settle";
import { COURT_HOLD_MINUTES, createCourtCheckout, ensureCustomer, getStripe } from "@/modules/payments/stripe";
import { requireStudent } from "@/modules/student/dal";

import { checkWindow, courtBookingSchema, MAX_OPEN_HOLDS, MIN_ONLINE_AMOUNT, platformFee } from "../lib/court-booking";

// Booking a court from the availability grid: a 15-minute hold, paid with
// Stripe Checkout.
//
//   1. Who: the signed-in student, from the Auth.js session (requireStudent).
//      The booking is never made for a user id the browser sends.
//   2. What: the input is parsed (zod: id format, date, HH:MM on the
//      15-minute grid, 30 minutes to 4 hours) and the window checked against
//      the court's opening hours, the notice and the booking horizon. The
//      price comes from the club's pricing rules, never from the client.
//   3. Hold: one transaction inserts a PENDING FacilityBooking and its
//      PaymentTransaction, both expiring at now() + 15 minutes on the
//      database clock. Nothing is checked first: the
//      FacilityBooking_no_overlap exclusion constraint (two rentals) and the
//      Facility_booking_overlap trigger (a rental and a coached session)
//      raise 23P01, which is the one source of truth even for two players
//      clicking the same slot at the same instant.
//   4. Checkout: outside the transaction (no locks held during a network
//      call), a Stripe Checkout Session is created as a destination charge
//      to the club's connected account, keyed by the payment id. If Stripe
//      fails, the hold is released. The webhook (checkout.session.completed)
//      confirms the booking; checkout.session.expired or the sweeper
//      releases an unpaid one.

export type BookCourtInput = {
  courtId: string;
  date: string;
  startTime: string;
  endTime: string;
};

export type BookCourtResult =
  | { ok: true; checkoutUrl: string }
  | {
      ok: false;
      code: "INVALID" | "UNAVAILABLE" | "SLOT_TAKEN" | "TOO_MANY_HOLDS" | "PAYMENTS_DOWN";
      error: string;
    };

const unavailable = (error: string): BookCourtResult => ({
  ok: false,
  code: "UNAVAILABLE",
  error,
});

export async function bookCourt(input: BookCourtInput): Promise<BookCourtResult> {
  const user = await requireStudent();
  const stripe = getStripe();
  if (!stripe)
    return {
      ok: false,
      code: "PAYMENTS_DOWN",
      error: "Online booking isn't available right now. Book at the club's front desk.",
    };

  // Server Actions are public endpoints: the argument is whatever was posted.
  const raw = (typeof input === "object" && input !== null ? input : {}) as Partial<Record<keyof BookCourtInput, unknown>>;
  const parsed = courtBookingSchema.safeParse({
    facilityId: raw.courtId,
    date: raw.date,
    startTime: raw.startTime,
    endTime: raw.endTime,
  });
  if (!parsed.success)
    return {
      ok: false,
      code: "INVALID",
      error: parsed.error.issues[0]?.message ?? "That slot isn't valid.",
    };
  const req = parsed.data;

  // Lapsed holds still block the slot in the constraint until they're released.
  await releaseExpiredHolds();

  const [target] = await db
    .select({
      id: facility.id,
      name: facility.name,
      openMinute: facility.openMinute,
      closeMinute: facility.closeMinute,
      rate: facility.hourlyRateAmount,
      clubId: club.id,
      clubName: club.name,
      timezone: club.timezone,
      currency: club.currency,
      destination: stripeAccount.stripeAccountId,
    })
    .from(facility)
    .innerJoin(club, eq(club.id, facility.clubId))
    .innerJoin(stripeAccount, eq(stripeAccount.clubId, club.id))
    .where(
      and(
        eq(facility.id, req.facilityId),
        eq(facility.isActive, true),
        eq(stripeAccount.chargesEnabled, true),
        eq(stripeAccount.payoutsEnabled, true),
        // Same rule as the grid: open to the public, with a live subscription.
        clubOpenToPublicSql(sql`"Club"`),
      ),
    );
  if (!target) return unavailable("That court can't be booked online.");

  const window = checkWindow(req, target, target.timezone);
  if (!window.ok) return unavailable(window.message);
  const { startsAt, endsAt } = window;

  const [{ n: openHolds = 0 } = {}] = await db
    .select({ n: count() })
    .from(facilityBooking)
    .where(and(eq(facilityBooking.customerId, user.id), eq(facilityBooking.status, "PENDING")));
  if (openHolds >= MAX_OPEN_HOLDS)
    return {
      ok: false,
      code: "TOO_MANY_HOLDS",
      error: "You have unpaid bookings waiting. Pay for or release them in Bookings first.",
    };

  const rules = await db
    .select({
      dayOfWeek: facilityPriceRule.dayOfWeek,
      startMinute: facilityPriceRule.startMinute,
      endMinute: facilityPriceRule.endMinute,
      tier: facilityPriceRule.tier,
      hourlyRateAmount: facilityPriceRule.hourlyRateAmount,
    })
    .from(facilityPriceRule)
    .where(eq(facilityPriceRule.facilityId, target.id));
  const amount = quoteBooking({
    startsAt,
    endsAt,
    timeZone: target.timezone,
    standardRate: target.rate,
    rules,
  }).total;
  if (amount < MIN_ONLINE_AMOUNT) return unavailable("This court can't be paid online; book it at the front desk.");
  const applicationFee = platformFee(amount, await platformFeeBpsFor(target.clubId));

  const paymentId = createId();
  const holdUntil = sql`now() + make_interval(mins => ${COURT_HOLD_MINUTES})`;
  let bookingId: string;
  try {
    bookingId = await db.transaction(async (tx) => {
      const [booking] = await tx
        .insert(facilityBooking)
        .values({
          clubId: target.clubId,
          facilityId: target.id,
          customerId: user.id,
          customerName: user.name,
          bookedById: user.id,
          startsAt,
          endsAt,
          status: "PENDING",
          holdExpiresAt: holdUntil,
          priceAmount: amount,
          currency: target.currency,
          paymentMethod: "ONLINE",
        })
        .returning({ id: facilityBooking.id });
      await tx.insert(paymentTransaction).values({
        id: paymentId,
        clubId: target.clubId,
        kind: "COURT_RENTAL",
        facilityBookingId: booking!.id,
        payerId: user.id,
        amount,
        currency: target.currency,
        applicationFeeAmount: applicationFee,
        status: "REQUIRES_PAYMENT_METHOD",
        transferGroup: `booking_${booking!.id}`,
        idempotencyKey: paymentId,
        checkoutExpiresAt: holdUntil,
      });
      return booking!.id;
    });
  } catch (error) {
    if (isBookingConflict(error))
      return {
        ok: false,
        code: "SLOT_TAKEN",
        error: "This timeslot was just taken. Pick another one.",
      };
    throw error;
  }

  const summary = `${target.name} · ${target.clubName} · ${req.date} ${minuteToTime(req.startTime)}–${minuteToTime(req.endTime)}`;
  let checkoutUrl: string;
  try {
    const customerId = await ensureCustomer(stripe, user);
    const checkout = await createCourtCheckout(stripe, {
      paymentId,
      bookingId,
      clubId: target.clubId,
      customerId,
      destination: target.destination,
      amount,
      applicationFee,
      currency: target.currency,
      description: `Court booking: ${summary}`,
      successPath: `/dashboard/student/bookings?checkout=success&payment=${paymentId}`,
      cancelPath: `/dashboard/student/book?club=${target.clubId}&date=${req.date}&checkout=cancelled`,
    });
    await db.update(paymentTransaction).set({ stripeCheckoutSessionId: checkout.id, checkoutUrl: checkout.url }).where(eq(paymentTransaction.id, paymentId));
    checkoutUrl = checkout.url;
  } catch (error) {
    console.error("[stripe] court checkout failed", error);
    await db.transaction(async (tx) => {
      await tx.update(paymentTransaction).set({ status: "CANCELED" }).where(eq(paymentTransaction.id, paymentId));
      await tx
        .update(facilityBooking)
        .set({
          status: "CANCELLED",
          cancelledAt: sql`now()`,
          cancellationReason: "Payment could not be started",
        })
        .where(eq(facilityBooking.id, bookingId));
    });
    return {
      ok: false,
      code: "PAYMENTS_DOWN",
      error: "Payments are unavailable right now, so the court wasn't held. Try again in a moment.",
    };
  }

  revalidatePath("/dashboard/student", "layout");
  return { ok: true, checkoutUrl };
}
