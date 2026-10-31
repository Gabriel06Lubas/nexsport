import "server-only";

import { and, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import type Stripe from "stripe";

import { db } from "@/db";
import { facilityBooking, paymentTransaction, paymentTransfer, practiceSession, sessionParticipant, stripeAccount } from "@/db/schema";
import { splitSessionPayment } from "@/modules/billing/lib/fee-split";

// What Stripe events do to our rows. Every function is safe to run twice or
// out of order (Stripe retries webhooks and doesn't guarantee ordering):
// each UPDATE is conditional on the state it moves from, so the second
// delivery of an event, or the second of two events meaning the same thing
// (checkout.session.completed and payment_intent.succeeded), changes nothing.

/** Payment states in which money hasn't been taken yet. */
const OPEN = ["REQUIRES_PAYMENT_METHOD", "REQUIRES_CONFIRMATION", "REQUIRES_ACTION", "PROCESSING"] as const;

export type SettleResult = "settled" | "already-settled" | "unknown" | { refund: { paymentId: string; paymentIntentId: string; amount: number; destinationCharge: boolean } };

/**
 * Money was taken for a payment: mark it SUCCEEDED and make the booking it
 * pays for final.
 *   * Session seat (separate charges and transfers): queue PENDING transfers
 *     for the club's and the coach's shares.
 *   * Court rental (destination charge): Stripe already moved the club's
 *     part; record that transfer as PAID and confirm the booking.
 * If the hold had already been released (expired, cancelled), the money is
 * refunded instead: the caller sends the refund returned here.
 */
export async function settlePayment(input: { paymentId: string; intentId: string | null; chargeId?: string | null }): Promise<SettleResult> {
  return db.transaction(async (tx) => {
    const [payment] = await tx
      .update(paymentTransaction)
      .set({
        status: "SUCCEEDED",
        paidAt: sql`now()`,
        stripePaymentIntentId: sql`COALESCE(${paymentTransaction.stripePaymentIntentId}, ${input.intentId})`,
        stripeChargeId: input.chargeId ?? null,
        checkoutUrl: null,
        failureCode: null,
        failureMessage: null,
      })
      .where(and(eq(paymentTransaction.id, input.paymentId), inArray(paymentTransaction.status, [...OPEN])))
      .returning();

    if (!payment) {
      // Paid after the hold was released: record it, then refund it in full.
      const [late] = await tx
        .update(paymentTransaction)
        .set({ status: "SUCCEEDED", paidAt: sql`now()`, stripePaymentIntentId: input.intentId, checkoutUrl: null, refundStatus: "PENDING", appliedRefundPercent: 100 })
        .where(and(eq(paymentTransaction.id, input.paymentId), inArray(paymentTransaction.status, ["CANCELED", "FAILED"])))
        .returning({ id: paymentTransaction.id, amount: paymentTransaction.amount, kind: paymentTransaction.kind });
      if (late && input.intentId) {
        return { refund: { paymentId: late.id, paymentIntentId: input.intentId, amount: late.amount, destinationCharge: late.kind === "COURT_RENTAL" } };
      }
      const [known] = await tx.select({ id: paymentTransaction.id }).from(paymentTransaction).where(eq(paymentTransaction.id, input.paymentId));
      return known ? "already-settled" : "unknown";
    }

    if (payment.kind === "COURT_RENTAL" && payment.facilityBookingId) {
      await tx
        .update(facilityBooking)
        .set({ status: "CONFIRMED", paidAt: sql`now()` })
        .where(and(eq(facilityBooking.id, payment.facilityBookingId), eq(facilityBooking.status, "PENDING")));
      const [club] = await tx.select({ id: stripeAccount.id }).from(stripeAccount).where(eq(stripeAccount.clubId, payment.clubId));
      if (club) {
        await tx
          .insert(paymentTransfer)
          .values({ paymentId: payment.id, stripeAccountId: club.id, recipientType: "CLUB", amount: payment.amount - payment.applicationFeeAmount, currency: payment.currency, status: "PAID" })
          .onConflictDoNothing();
      }
      return "settled";
    }

    if (payment.kind === "SESSION" && payment.sessionId) {
      // The split: platform fee, then the coach's share; the club keeps the
      // rest. Card processing isn't known yet; the platform absorbs it here.
      const [s] = await tx
        .select({ coachId: practiceSession.coachId, coachShareBps: practiceSession.coachShareBps, clubId: practiceSession.clubId })
        .from(practiceSession)
        .where(eq(practiceSession.id, payment.sessionId));
      if (!s) return "settled";
      const split = splitSessionPayment({
        amount: payment.amount,
        platformFeeBps: Math.round((payment.applicationFeeAmount * 10_000) / payment.amount),
        coachShareBps: s.coachShareBps,
        processingFee: 0,
      });
      const accounts = await tx
        .select({ id: stripeAccount.id, clubId: stripeAccount.clubId, userId: stripeAccount.userId })
        .from(stripeAccount)
        .where(sql`${stripeAccount.clubId} = ${s.clubId} OR ${stripeAccount.userId} = ${s.coachId}`);
      const clubAccount = accounts.find((a) => a.clubId === s.clubId);
      const coachAccount = accounts.find((a) => a.userId === s.coachId);
      const rows = [
        clubAccount && split.clubAmount > 0 ? { recipientType: "CLUB" as const, stripeAccountId: clubAccount.id, amount: split.clubAmount } : null,
        coachAccount && split.coachAmount > 0 ? { recipientType: "COACH" as const, stripeAccountId: coachAccount.id, amount: split.coachAmount } : null,
      ].filter((r) => r !== null);
      if (rows.length) {
        await tx
          .insert(paymentTransfer)
          .values(rows.map((r) => ({ ...r, paymentId: payment.id, currency: payment.currency, status: "PENDING" as const })))
          .onConflictDoNothing();
      }
    }
    return "settled";
  });
}

/** checkout.session.completed / async_payment_succeeded. */
export async function settleCheckout(session: Stripe.Checkout.Session) {
  const paymentId = session.metadata?.paymentId ?? session.client_reference_id;
  if (!paymentId || session.payment_status !== "paid") return "unknown" as const;
  const intentId = typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? null);
  return settlePayment({ paymentId, intentId });
}

/** payment_intent.succeeded. */
export async function settleIntent(intent: Stripe.PaymentIntent) {
  const paymentId = intent.metadata?.paymentId;
  if (!paymentId) return "unknown" as const;
  const chargeId = typeof intent.latest_charge === "string" ? intent.latest_charge : (intent.latest_charge?.id ?? null);
  return settlePayment({ paymentId, intentId: intent.id, chargeId });
}

/**
 * payment_intent.payment_failed: a card was declined or authentication
 * failed. The PaymentIntent goes back to requires_payment_method and can be
 * retried with another card, so the hold is kept until it expires; the
 * failure is recorded (and shown), and if the hold expires without a
 * successful retry the sweeper marks the payment FAILED.
 */
export async function recordIntentFailure(intent: Stripe.PaymentIntent) {
  const paymentId = intent.metadata?.paymentId;
  if (!paymentId) return 0;
  const updated = await db
    .update(paymentTransaction)
    .set({ failureCode: intent.last_payment_error?.decline_code ?? intent.last_payment_error?.code ?? "payment_failed", failureMessage: intent.last_payment_error?.message?.slice(0, 500) ?? "Payment failed" })
    .where(and(eq(paymentTransaction.id, paymentId), inArray(paymentTransaction.status, [...OPEN])))
    .returning({ id: paymentTransaction.id });
  return updated.length;
}

/** Releases what an unpaid payment was holding: the seat, or the court slot. */
async function releaseHeld(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], rows: { participantId: string | null; facilityBookingId: string | null }[]) {
  const seats = rows.map((r) => r.participantId).filter((id): id is string => !!id);
  const courts = rows.map((r) => r.facilityBookingId).filter((id): id is string => !!id);
  if (seats.length) {
    await tx
      .update(sessionParticipant)
      .set({ status: "CANCELLED", cancelledAt: sql`now()` })
      .where(and(inArray(sessionParticipant.id, seats), eq(sessionParticipant.status, "ACCEPTED")));
  }
  if (courts.length) {
    await tx
      .update(facilityBooking)
      .set({ status: "CANCELLED", cancelledAt: sql`now()`, cancellationReason: "Payment not completed" })
      .where(and(inArray(facilityBooking.id, courts), eq(facilityBooking.status, "PENDING")));
  }
  return seats.length + courts.length;
}

/** checkout.session.expired: the seat hold ends. */
export async function releaseCheckoutHold(checkoutSessionId: string) {
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(paymentTransaction)
      .set({ status: "CANCELED", checkoutUrl: null })
      .where(and(eq(paymentTransaction.stripeCheckoutSessionId, checkoutSessionId), inArray(paymentTransaction.status, [...OPEN])))
      .returning({ participantId: paymentTransaction.participantId, facilityBookingId: paymentTransaction.facilityBookingId });
    return releaseHeld(tx, rows);
  });
}

/** payment_intent.canceled: whatever it was holding is released. */
export async function releaseIntentHold(intent: Stripe.PaymentIntent) {
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(paymentTransaction)
      .set({ status: "CANCELED" })
      .where(and(eq(paymentTransaction.stripePaymentIntentId, intent.id), inArray(paymentTransaction.status, [...OPEN])))
      .returning({ participantId: paymentTransaction.participantId, facilityBookingId: paymentTransaction.facilityBookingId });
    return releaseHeld(tx, rows);
  });
}

/**
 * Releases unpaid holds whose time has passed (seats and court slots), in
 * case Stripe's events are late or lost. Runs before seats or slots are
 * counted. A payment that saw a declined card ends FAILED, otherwise
 * CANCELED. Served by PaymentTransaction_status_idx: open holds are a small
 * slice of all payments.
 */
export async function releaseExpiredHolds(sessionId?: string) {
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(paymentTransaction)
      .set({ status: sql`CASE WHEN ${paymentTransaction.failureCode} IS NOT NULL THEN 'FAILED'::"PaymentStatus" ELSE 'CANCELED'::"PaymentStatus" END`, checkoutUrl: null })
      .where(
        and(
          eq(paymentTransaction.status, "REQUIRES_PAYMENT_METHOD"),
          isNotNull(paymentTransaction.checkoutExpiresAt),
          lt(paymentTransaction.checkoutExpiresAt, sql`now()`),
          sessionId ? eq(paymentTransaction.sessionId, sessionId) : sql`true`,
        ),
      )
      .returning({ participantId: paymentTransaction.participantId, facilityBookingId: paymentTransaction.facilityBookingId });
    return releaseHeld(tx, rows);
  });
}
