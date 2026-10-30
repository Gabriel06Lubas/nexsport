import "server-only";

import { and, eq, inArray, lt, sql } from "drizzle-orm";
import type Stripe from "stripe";

import { db } from "@/db";
import { paymentTransaction, paymentTransfer, practiceSession, sessionParticipant, stripeAccount } from "@/db/schema";
import { splitSessionPayment } from "@/modules/billing/lib/fee-split";

// What happens to our rows when Stripe reports on a seat payment. Each
// function is safe to run twice (webhooks are retried): every UPDATE is
// conditional on the state it moves from.

/** Checkout paid: payment SUCCEEDED, the seat stays, transfers are queued. */
export async function settleSeatPayment(session: Stripe.Checkout.Session) {
  const paymentId = session.metadata?.paymentId ?? session.client_reference_id;
  if (!paymentId || session.payment_status !== "paid") return "ignored";
  const intentId = typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? null);

  return db.transaction(async (tx) => {
    const [payment] = await tx
      .update(paymentTransaction)
      .set({ status: "SUCCEEDED", paidAt: sql`now()`, stripePaymentIntentId: intentId, checkoutUrl: null })
      .where(and(eq(paymentTransaction.id, paymentId), inArray(paymentTransaction.status, ["REQUIRES_PAYMENT_METHOD", "PROCESSING"])))
      .returning();
    if (!payment) {
      // Paid after the seat was released (hold expired, or the student
      // cancelled while checkout was open): record it and refund it in full.
      const [late] = await tx
        .update(paymentTransaction)
        .set({ status: "SUCCEEDED", paidAt: sql`now()`, stripePaymentIntentId: intentId, checkoutUrl: null, refundStatus: "PENDING", appliedRefundPercent: 100 })
        .where(and(eq(paymentTransaction.id, paymentId), eq(paymentTransaction.status, "CANCELED")))
        .returning({ id: paymentTransaction.id, amount: paymentTransaction.amount });
      return late && intentId ? { refund: { paymentId: late.id, paymentIntentId: intentId, amount: late.amount } } : "already-settled";
    }

    // The split: platform fee, then the coach's share, the club keeps the rest.
    // Card processing isn't known yet; the platform absorbs it on these rows.
    const [s] = await tx
      .select({ coachId: practiceSession.coachId, coachShareBps: practiceSession.coachShareBps, clubId: practiceSession.clubId })
      .from(practiceSession)
      .where(eq(practiceSession.id, payment.sessionId!));
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
    return "settled";
  });
}

/** Checkout expired unpaid: the hold ends and the seat is released. */
export async function releaseSeatHold(checkoutSessionId: string) {
  return db.transaction(async (tx) => {
    const [payment] = await tx
      .update(paymentTransaction)
      .set({ status: "CANCELED", checkoutUrl: null })
      .where(and(eq(paymentTransaction.stripeCheckoutSessionId, checkoutSessionId), eq(paymentTransaction.status, "REQUIRES_PAYMENT_METHOD")))
      .returning({ participantId: paymentTransaction.participantId });
    if (!payment?.participantId) return "ignored";
    await tx
      .update(sessionParticipant)
      .set({ status: "CANCELLED", cancelledAt: sql`now()` })
      .where(and(eq(sessionParticipant.id, payment.participantId), eq(sessionParticipant.status, "ACCEPTED")));
    return "released";
  });
}

/**
 * Releases unpaid holds whose checkout window has passed, in case the
 * expiry webhook is late or lost. Called before seats are counted.
 */
export async function releaseExpiredHolds(sessionId?: string) {
  const expired = await db
    .update(paymentTransaction)
    .set({ status: "CANCELED", checkoutUrl: null })
    .where(
      and(
        eq(paymentTransaction.status, "REQUIRES_PAYMENT_METHOD"),
        lt(paymentTransaction.checkoutExpiresAt, sql`now()`),
        sessionId ? eq(paymentTransaction.sessionId, sessionId) : sql`true`,
      ),
    )
    .returning({ participantId: paymentTransaction.participantId });
  const ids = expired.map((e) => e.participantId).filter((id): id is string => !!id);
  if (ids.length) {
    await db
      .update(sessionParticipant)
      .set({ status: "CANCELLED", cancelledAt: sql`now()` })
      .where(and(inArray(sessionParticipant.id, ids), eq(sessionParticipant.status, "ACCEPTED")));
  }
  return ids.length;
}
