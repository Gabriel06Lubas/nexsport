import "server-only";

import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type Stripe from "stripe";

import { db } from "@/db";
import { paymentTransaction } from "@/db/schema";

import { sendPendingTransfers } from "./connect";
import { releaseCheckoutHold, settleCheckout, type SettleResult } from "./settle";
import { getStripe, refundPayment } from "./stripe";

// What happens once a payment is settled, whoever noticed it first: the
// webhook (checkout.session.completed, payment_intent.succeeded) or the
// player coming back from Stripe (reconcileCheckout). Both run the same
// idempotent steps, so the second one to arrive changes nothing.

/**
 * Settled (now, or by an earlier delivery of the same outcome): send the
 * seat's shares to the club and the coach, if their accounts can receive
 * them. A failure here never fails the caller: the payment is settled, and
 * the shares stay PENDING for the next attempt (a webhook retry, the
 * account's next update, or the owner's next visit to Billing / Earnings).
 */
export async function afterSettle(stripe: Stripe, paymentId: string | null | undefined, result: SettleResult) {
  if ((result === "settled" || result === "already-settled") && paymentId) {
    await sendPendingTransfers(stripe, { paymentId }).catch((error) => console.error(`[connect] sending shares of ${paymentId} failed`, error));
  }
  return refundIfLate(stripe, result);
}

/** A payment that landed after its hold was released is refunded in full. */
async function refundIfLate(stripe: Stripe, result: SettleResult) {
  if (typeof result !== "object") return;
  await refundPayment(stripe, result.refund);
  await db
    .update(paymentTransaction)
    .set({ refundStatus: "REFUNDED", refundedAmount: result.refund.amount, refundedAt: sql`now()` })
    .where(eq(paymentTransaction.id, result.refund.paymentId));
}

const OPEN = ["REQUIRES_PAYMENT_METHOD", "REQUIRES_CONFIRMATION", "REQUIRES_ACTION", "PROCESSING"] as const;

export type Reconciled = "settled" | "expired" | "open" | "unknown";

/**
 * Asks Stripe how a player's Checkout ended, instead of waiting for the
 * webhook: a lost or late event (a local `stripe listen` not running, a
 * wrong signing secret, a Stripe delay) otherwise leaves a paid booking
 * "waiting for payment", and Pay now reopens a Checkout Stripe says is
 * already paid.
 *
 * Only the payer's own open payment is looked at, and only through the
 * Checkout Session id stored on it (never an id from the request). The
 * session must carry the same payment id. Settling goes through the same
 * code as the webhook, so whichever comes second is a no-op.
 */
export async function reconcileCheckout(paymentId: string, payerId: string): Promise<Reconciled> {
  const stripe = getStripe();
  if (!stripe) return "unknown";
  const [payment] = await db
    .select({ checkoutId: paymentTransaction.stripeCheckoutSessionId })
    .from(paymentTransaction)
    .where(and(eq(paymentTransaction.id, paymentId), eq(paymentTransaction.payerId, payerId), inArray(paymentTransaction.status, [...OPEN]), isNotNull(paymentTransaction.stripeCheckoutSessionId)));
  if (!payment?.checkoutId) return "unknown";

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.retrieve(payment.checkoutId);
  } catch (error) {
    console.error(`[stripe] could not check Checkout ${payment.checkoutId}`, error);
    return "unknown";
  }
  if ((session.metadata?.paymentId ?? session.client_reference_id) !== paymentId) return "unknown";

  if (session.status === "complete" && session.payment_status === "paid") {
    const result = await settleCheckout(session);
    await afterSettle(stripe, paymentId, result);
    return "settled";
  }
  if (session.status === "expired") {
    await releaseCheckoutHold(session.id);
    return "expired";
  }
  return "open";
}

/** Every open Checkout payment of one player (at most a handful: holds are capped), checked with Stripe. */
export async function reconcileOpenCheckouts(payerId: string): Promise<number> {
  const open = await db
    .select({ id: paymentTransaction.id })
    .from(paymentTransaction)
    .where(and(eq(paymentTransaction.payerId, payerId), inArray(paymentTransaction.status, [...OPEN]), isNotNull(paymentTransaction.stripeCheckoutSessionId)))
    .limit(5);
  const results = await Promise.all(open.map((p) => reconcileCheckout(p.id, payerId)));
  return results.filter((r) => r === "settled").length;
}
