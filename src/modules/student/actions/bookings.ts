"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { facilityBooking, paymentTransaction, practiceSession, sessionParticipant } from "@/db/schema";
import { formValues, type ActionState } from "@/lib/action-state";
import { formatMoney } from "@/lib/utils";
import { computeRefund } from "@/modules/billing/lib/refund-policy";
import { getStripe, refundPayment } from "@/modules/payments/stripe";

import { requireStudent } from "../dal";
import { cancelSchema } from "../lib/forms";
import { getMyBooking } from "../queries/bookings";
import { loadPolicy } from "../queries/policy";

// A student cancels one of their own bookings. The refund follows the
// club's cancellation policy at the moment of cancelling (the rule and
// percentage are saved on the payment). The cancellation is committed
// first; the Stripe refund follows, and if Stripe fails it stays PENDING
// for the club to see, rather than being lost.

export async function cancelMyBooking(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const student = await requireStudent();
  const parsed = cancelSchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: "Unknown booking." };
  const booking = await getMyBooking(student.id, parsed.data.kind, parsed.data.id);
  if (!booking || booking.status === "CANCELLED") return { error: "That booking is already cancelled." };
  if (booking.startsAt.getTime() <= Date.now()) return { error: "It has already started, so it can't be cancelled here." };

  // A seat still waiting for payment: release it, nothing to refund.
  if (booking.status === "PENDING" && booking.paymentId && booking.paymentStatus === "REQUIRES_PAYMENT_METHOD") {
    const [payment] = await db
      .select({ checkoutId: paymentTransaction.stripeCheckoutSessionId })
      .from(paymentTransaction)
      .where(eq(paymentTransaction.id, booking.paymentId));
    const stripe = getStripe();
    if (stripe && payment?.checkoutId) await stripe.checkout.sessions.expire(payment.checkoutId).catch(() => undefined);
    await db.transaction(async (tx) => {
      await tx.update(paymentTransaction).set({ status: "CANCELED", checkoutUrl: null }).where(and(eq(paymentTransaction.id, booking.paymentId!), eq(paymentTransaction.status, "REQUIRES_PAYMENT_METHOD")));
      await tx.update(sessionParticipant).set({ status: "CANCELLED", cancelledAt: sql`now()` }).where(eq(sessionParticipant.id, booking.participantId!));
    });
    revalidatePath("/dashboard/student", "layout");
    return { ok: "Spot released. You weren't charged." };
  }

  const policy = await loadPolicy(booking.clubId, booking.policyId);
  const hours = (booking.startsAt.getTime() - Date.now()) / 3_600_000;
  const paidOnline = booking.paymentStatus === "SUCCEEDED" && booking.paymentAmount !== null;
  const refundable = paidOnline ? booking.paymentAmount! - (booking.refundedAmount ?? 0) : booking.rentalPayment === "ON_SITE" && booking.paidAt ? booking.priceAmount : 0;
  const decision = computeRefund(policy, refundable, hours, "PARTICIPANT");

  const done = await db.transaction(async (tx) => {
    if (booking.kind === "session") {
      const [left] = await tx
        .update(sessionParticipant)
        .set({ status: "CANCELLED", cancelledAt: sql`now()` })
        .where(and(eq(sessionParticipant.id, booking.participantId!), eq(sessionParticipant.userId, student.id), inArray(sessionParticipant.status, ["ACCEPTED", "INVITED", "WAITLISTED"])))
        .returning({ id: sessionParticipant.id });
      if (!left) return false;
      // A private session the student booked themselves goes away entirely,
      // freeing the coach and the court.
      await tx
        .update(practiceSession)
        .set({ status: "CANCELLED", cancelledAt: sql`now()`, cancelledById: student.id, cancellationReason: "Cancelled by the student" })
        .where(and(eq(practiceSession.id, booking.id), eq(practiceSession.kind, "PRIVATE"), eq(practiceSession.createdById, student.id), eq(practiceSession.status, "SCHEDULED")));
    } else {
      const [cancelled] = await tx
        .update(facilityBooking)
        .set({ status: "CANCELLED", cancelledAt: sql`now()`, cancelledById: student.id, cancellationReason: "Cancelled by the customer" })
        .where(and(eq(facilityBooking.id, booking.id), eq(facilityBooking.customerId, student.id), eq(facilityBooking.status, "CONFIRMED")))
        .returning({ id: facilityBooking.id });
      if (!cancelled) return false;
    }
    if (paidOnline) {
      await tx
        .update(paymentTransaction)
        .set({ refundStatus: decision.refundAmount > 0 ? "PENDING" : "NONE", appliedRefundPercent: decision.refundPercent, cancellationPolicyId: policy.id, refundReason: "Cancelled by the student" })
        .where(eq(paymentTransaction.id, booking.paymentId!));
    }
    return true;
  });
  if (!done) return { error: "That booking is already cancelled." };
  revalidatePath("/dashboard/student", "layout");

  const amount = formatMoney(decision.refundAmount, booking.currency);
  if (decision.refundAmount === 0) {
    return { ok: refundable > 0 ? `Cancelled. No refund at this point (${policy.name}).` : "Cancelled." };
  }
  if (!paidOnline) return { ok: `Cancelled. You paid at the desk: ask the club for your ${amount} (${decision.refundPercent}%) refund.` };

  const stripe = getStripe();
  const [payment] = await db.select({ intent: paymentTransaction.stripePaymentIntentId, refunded: paymentTransaction.refundedAmount, amount: paymentTransaction.amount }).from(paymentTransaction).where(eq(paymentTransaction.id, booking.paymentId!));
  if (stripe && payment?.intent) {
    try {
      await refundPayment(stripe, { paymentId: booking.paymentId!, paymentIntentId: payment.intent, amount: decision.refundAmount });
      const total = payment.refunded + decision.refundAmount;
      await db
        .update(paymentTransaction)
        .set({ refundStatus: total >= payment.amount ? "REFUNDED" : "PARTIALLY_REFUNDED", refundedAmount: total, refundedAt: sql`now()` })
        .where(eq(paymentTransaction.id, booking.paymentId!));
      return { ok: `Cancelled. ${amount} (${decision.refundPercent}%) is on its way back to your card.` };
    } catch (error) {
      console.error("[stripe] refund failed", error);
    }
  }
  return { ok: `Cancelled. Your ${amount} (${decision.refundPercent}%) refund is being processed.` };
}
