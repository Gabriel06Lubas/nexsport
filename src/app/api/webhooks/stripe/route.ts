import { eq, sql } from "drizzle-orm";
import type { NextRequest } from "next/server";
import type Stripe from "stripe";

import { db } from "@/db";
import { paymentTransaction, stripeWebhookEvent } from "@/db/schema";
import {
  recordIntentFailure,
  releaseCheckoutHold,
  releaseIntentHold,
  settleCheckout,
  settleIntent,
  type SettleResult,
} from "@/modules/payments/settle";
import { getStripe, refundPayment } from "@/modules/payments/stripe";

// POST /api/webhooks/stripe
//
// 1. The signature is verified against the *raw* body (request.text(), never
//    a re-serialised JSON object) with STRIPE_WEBHOOK_SECRET; anything else
//    is a 400. Stripe's default 5-minute tolerance rejects replays of old
//    signed payloads.
// 2. The event id is recorded in StripeWebhookEvent before handling (the
//    admin's webhook log). An event already processed is acknowledged and
//    skipped, so Stripe's retries are harmless; the handlers are idempotent
//    anyway, because the same outcome can arrive through two events.
// 3. A handler failure is stored on the event and answered with 500, so
//    Stripe retries it (with backoff, for up to 3 days).
export async function POST(request: NextRequest) {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!stripe || !secret) return new Response("Stripe is not configured", { status: 404 });

  const signature = request.headers.get("stripe-signature");
  const body = await request.text();
  let event: Stripe.Event;
  try {
    if (!signature) throw new Error("missing signature");
    event = stripe.webhooks.constructEvent(body, signature, secret);
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }

  const [existing] = await db.select({ processedAt: stripeWebhookEvent.processedAt }).from(stripeWebhookEvent).where(eq(stripeWebhookEvent.id, event.id));
  if (existing?.processedAt) return Response.json({ received: true, duplicate: true });
  if (!existing) {
    await db.insert(stripeWebhookEvent).values({ id: event.id, type: event.type, livemode: event.livemode }).onConflictDoNothing();
  }

  try {
    await handle(stripe, event);
    await db.update(stripeWebhookEvent).set({ processedAt: sql`now()`, error: null }).where(eq(stripeWebhookEvent.id, event.id));
    return Response.json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[stripe webhook] ${event.type} ${event.id} failed`, error);
    await db.update(stripeWebhookEvent).set({ error: message.slice(0, 500) }).where(eq(stripeWebhookEvent.id, event.id));
    return new Response("Webhook handling failed", { status: 500 });
  }
}

async function handle(stripe: Stripe, event: Stripe.Event) {
  switch (event.type) {
    // Money taken. Seats paid through Checkout raise both events; whichever
    // comes first settles the payment, the second changes nothing.
    case "payment_intent.succeeded":
      return refundIfLate(stripe, await settleIntent(event.data.object));
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      return refundIfLate(stripe, await settleCheckout(event.data.object));

    // A declined card: recorded, the hold is kept for a retry until it expires.
    case "payment_intent.payment_failed":
      return recordIntentFailure(event.data.object);

    // Gave up: release the seat or the court slot.
    case "payment_intent.canceled":
      return releaseIntentHold(event.data.object);
    case "checkout.session.expired":
      return releaseCheckoutHold(event.data.object.id);

    default:
      return; // recorded in the log, nothing to do
  }
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
