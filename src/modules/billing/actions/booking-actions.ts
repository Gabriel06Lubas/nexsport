"use server";

import { createId } from "@paralleldrive/cuid2";
import { and, count, eq, gt, lt, ne, sql } from "drizzle-orm";

import { db } from "@/db";
import { isBookingConflict } from "@/db/errors";
import { club, facility, facilityBooking, facilityPriceRule, paymentTransaction, practiceSession, stripeAccount } from "@/db/schema";
import { formValues, invalid, type ActionState } from "@/lib/action-state";
import { formatMoney } from "@/lib/utils";
import { quoteBooking } from "@/modules/clubs/lib/pricing";
import { minuteToTime } from "@/modules/clubs/lib/zoned-time";
import { platformFeeBpsFor } from "@/modules/payments/platform-fee";
import { releaseExpiredHolds } from "@/modules/payments/settle";
import { COURT_HOLD_MINUTES, createCourtPaymentIntent, ensureCustomer, getStripe } from "@/modules/payments/stripe";
import { requireStudent } from "@/modules/student/dal";

import { checkWindow, courtBookingSchema, MAX_OPEN_HOLDS, MIN_ONLINE_AMOUNT, platformFee } from "../lib/court-booking";

// Booking a court and paying for it online.
//
//   1. Who: the signed-in student (Auth.js session, checked by the DAL).
//   2. What: the request is parsed (zod) and the window checked against the
//      facility's opening hours, the clock and the booking horizon. The
//      price is computed here from the facility's dynamic pricing, never
//      taken from the client.
//   3. Hold: one database transaction re-checks the slot and inserts a
//      PENDING FacilityBooking plus its PaymentTransaction. The database has
//      the last word: the FacilityBooking_no_overlap exclusion constraint and
//      the rental-vs-session trigger refuse an overlap even when two
//      customers submit the same slot at the same instant, and a PENDING
//      booking blocks the slot like a confirmed one.
//   4. Charge: outside the transaction (no row locks held during a network
//      call), a PaymentIntent is created as a destination charge to the
//      club's connected account, with nexport's fee as application_fee_amount.
//      The idempotency key is the payment's id, so a retry can't create a
//      second charge. If Stripe fails, the hold is released.
//   5. The client gets the PaymentIntent's client_secret and confirms the
//      payment with Stripe.js. The webhook (payment_intent.succeeded) turns
//      the booking CONFIRMED; an unpaid hold is released after
//      COURT_HOLD_MINUTES.

export type CourtBookingState = ActionState & {
  payment?: {
    clientSecret: string;
    bookingId: string;
    paymentId: string;
    amount: number;
    currency: string;
    holdExpiresAt: string;
    summary: string;
  };
};

export async function createCourtBookingAction(_prev: CourtBookingState, formData: FormData): Promise<CourtBookingState> {
  const user = await requireStudent();
  const stripe = getStripe();
  if (!stripe) return { error: "Online booking isn't available right now. Book at the club's front desk." };

  const values = formValues(formData);
  const parsed = courtBookingSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error, values);
  const req = parsed.data;
  const fail = (field: string, message: string): CourtBookingState => ({ error: "Check the highlighted fields.", fieldErrors: { [field]: message }, values });

  // Free slots held by abandoned payments before looking at availability.
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
        eq(club.status, "ACTIVE"),
        sql`${club.deletedAt} IS NULL`,
        eq(stripeAccount.chargesEnabled, true),
        eq(stripeAccount.payoutsEnabled, true),
      ),
    );
  if (!target) return fail("facilityId", "That court can't be booked online");

  const window = checkWindow(req, target, target.timezone);
  if (!window.ok) return fail(window.field, window.message);
  const { startsAt, endsAt } = window;

  const [{ n: openHolds = 0 } = {}] = await db
    .select({ n: count() })
    .from(facilityBooking)
    .where(and(eq(facilityBooking.customerId, user.id), eq(facilityBooking.status, "PENDING")));
  if (openHolds >= MAX_OPEN_HOLDS) return { error: "You have unpaid bookings waiting. Pay for or release them first.", values };

  const rules = await db
    .select({ dayOfWeek: facilityPriceRule.dayOfWeek, startMinute: facilityPriceRule.startMinute, endMinute: facilityPriceRule.endMinute, tier: facilityPriceRule.tier, hourlyRateAmount: facilityPriceRule.hourlyRateAmount })
    .from(facilityPriceRule)
    .where(eq(facilityPriceRule.facilityId, target.id));
  const amount = quoteBooking({ startsAt, endsAt, timeZone: target.timezone, standardRate: target.rate, rules }).total;
  if (amount < MIN_ONLINE_AMOUNT) return fail("facilityId", "This court can't be paid online; book it at the front desk");
  const applicationFee = platformFee(amount, await platformFeeBpsFor(target.clubId));

  const paymentId = createId();
  const holdExpiresAt = new Date(Date.now() + COURT_HOLD_MINUTES * 60_000);
  let bookingId: string;
  try {
    bookingId = await db.transaction(async (tx) => {
      // Friendly early answer; the constraint and trigger below are the guarantee.
      const [busy] = await tx
        .select({ id: facilityBooking.id })
        .from(facilityBooking)
        .where(and(eq(facilityBooking.facilityId, target.id), ne(facilityBooking.status, "CANCELLED"), lt(facilityBooking.startsAt, endsAt), gt(facilityBooking.endsAt, startsAt)))
        .unionAll(
          tx
            .select({ id: practiceSession.id })
            .from(practiceSession)
            .where(and(eq(practiceSession.facilityId, target.id), ne(practiceSession.status, "CANCELLED"), lt(practiceSession.startsAt, endsAt), gt(practiceSession.endsAt, startsAt))),
        )
        .limit(1);
      if (busy) throw new SlotTaken();

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
        checkoutExpiresAt: holdExpiresAt,
      });
      return booking!.id;
    });
  } catch (e) {
    if (e instanceof SlotTaken || isBookingConflict(e)) return fail("startTime", "That slot was just taken. Pick another time.");
    throw e;
  }

  const summary = `${target.name} · ${target.clubName} · ${req.date} ${minuteToTime(req.startTime)}–${minuteToTime(req.endTime)}`;
  let clientSecret: string;
  try {
    const customerId = await ensureCustomer(stripe, user);
    const intent = await createCourtPaymentIntent(stripe, {
      paymentId,
      bookingId,
      clubId: target.clubId,
      customerId,
      destination: target.destination,
      amount,
      applicationFee,
      currency: target.currency,
      description: `Court booking: ${summary}`,
      receiptEmail: user.email,
    });
    if (!intent.client_secret) throw new Error("PaymentIntent without a client secret");
    await db.update(paymentTransaction).set({ stripePaymentIntentId: intent.id }).where(eq(paymentTransaction.id, paymentId));
    clientSecret = intent.client_secret;
  } catch (error) {
    console.error("[stripe] court PaymentIntent failed", error);
    await db.transaction(async (tx) => {
      await tx.update(paymentTransaction).set({ status: "CANCELED" }).where(eq(paymentTransaction.id, paymentId));
      await tx
        .update(facilityBooking)
        .set({ status: "CANCELLED", cancelledAt: sql`now()`, cancellationReason: "Payment could not be started" })
        .where(eq(facilityBooking.id, bookingId));
    });
    return { error: "Payments are unavailable right now, so the court wasn't held. Try again in a moment.", values };
  }

  return {
    ok: `${formatMoney(amount, target.currency)} for ${summary}. The court is held for ${COURT_HOLD_MINUTES} minutes while you pay.`,
    payment: { clientSecret, bookingId, paymentId, amount, currency: target.currency, holdExpiresAt: holdExpiresAt.toISOString(), summary },
  };
}

class SlotTaken extends Error {}
