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
import { connectAccountChanged, disconnectConnectAccount, sendPendingTransfers } from "@/modules/payments/connect";
import { getStripe, refundPayment } from "@/modules/payments/stripe";
import { expirePlanCheckout, provisionFromCheckout, syncSubscription } from "@/modules/payments/subscriptions";

// POST /api/webhooks/stripe
//
// 1. The signature is verified against the *raw* body (request.text(), never
//    a re-serialised JSON object) with one of the endpoints' secrets:
//    STRIPE_WEBHOOK_SECRET (platform events), STRIPE_CONNECT_WEBHOOK_SECRET
//    (events from connected accounts, such as account.updated) or
//    STRIPE_V2_WEBHOOK_SECRET (the thin-payload event destination for
//    Accounts v2 events, v2.core.account*). Anything else is a 400. Stripe's
//    default 5-minute tolerance rejects replays of old signed payloads.
// 2. The event id is recorded in StripeWebhookEvent before handling (the
//    admin's webhook log). An event already processed is acknowledged and
//    skipped, so Stripe's retries are harmless; the handlers are idempotent
//    anyway, because the same outcome can arrive through two events.
// 3. A handler failure is stored on the event and answered with 500, so
//    Stripe retries it (with backoff, for up to 3 days).
export async function POST(request: NextRequest) {
  const stripe = getStripe();
  const secrets = [process.env.STRIPE_WEBHOOK_SECRET, process.env.STRIPE_CONNECT_WEBHOOK_SECRET, process.env.STRIPE_V2_WEBHOOK_SECRET]
    .map((s) => s?.trim())
    .filter((s): s is string => !!s);
  if (!stripe || secrets.length === 0) return new Response("Stripe is not configured", { status: 404 });

  const signature = request.headers.get("stripe-signature");
  const body = await request.text();
  // Snapshot events ("event") and thin event notifications ("v2.core.event") are parsed by different SDK calls.
  let thin = false;
  try {
    thin = (JSON.parse(body) as { object?: unknown } | null)?.object === "v2.core.event";
  } catch {
    return new Response("Invalid payload", { status: 400 });
  }
  let event: { id: string; type: string; livemode: boolean } | null = null;
  let run: (() => Promise<unknown>) | null = null;
  for (const secret of signature ? secrets : []) {
    try {
      if (thin) {
        const notification = stripe.parseEventNotification(body, signature!, secret);
        event = notification;
        run = () => handleThin(stripe, notification);
      } else {
        const snapshot = stripe.webhooks.constructEvent(body, signature!, secret);
        event = snapshot;
        run = () => handle(stripe, snapshot);
      }
      break;
    } catch {
      // try the other endpoints' secrets
    }
  }
  if (!event || !run) return new Response("Invalid signature", { status: 400 });

  const [existing] = await db.select({ processedAt: stripeWebhookEvent.processedAt }).from(stripeWebhookEvent).where(eq(stripeWebhookEvent.id, event.id));
  if (existing?.processedAt) return Response.json({ received: true, duplicate: true });
  if (!existing) {
    await db.insert(stripeWebhookEvent).values({ id: event.id, type: event.type, livemode: event.livemode }).onConflictDoNothing();
  }

  try {
    await run();
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
      return afterSettle(stripe, event.data.object.metadata?.paymentId, await settleIntent(event.data.object));
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      // A plan purchase: verify with Stripe, then provision (club, role, subscription).
      if (event.data.object.mode === "subscription") return provisionFromCheckout(stripe, event.data.object);
      return afterSettle(stripe, event.data.object.metadata?.paymentId ?? event.data.object.client_reference_id, await settleCheckout(event.data.object));

    // A declined card: recorded, the hold is kept for a retry until it expires.
    case "payment_intent.payment_failed":
      return recordIntentFailure(event.data.object);

    // Gave up: release the seat or the court slot.
    case "payment_intent.canceled":
      return releaseIntentHold(event.data.object);
    case "checkout.session.expired":
      if (event.data.object.mode === "subscription") return expirePlanCheckout(event.data.object);
      return releaseCheckoutHold(event.data.object.id);

    // Plan status changes (failed renewal → PAST_DUE, cancellation, plan
    // change in the portal): what entitlements are computed from.
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.paused":
    case "customer.subscription.resumed":
      return syncSubscription(event.data.object);

    // Connect (from the Connect endpoint): an account's onboarding state or
    // capabilities changed. Turns online court booking and seat payouts on or
    // off. The account is re-read through Accounts v2, the shape nexport stores.
    case "account.updated":
      return connectAccountChanged(stripe, event.data.object.id);
    case "account.application.deauthorized":
      if (event.account) await disconnectConnectAccount(event.account);
      return;

    default:
      return; // recorded in the log, nothing to do
  }
}

/**
 * Thin event notifications (the Accounts v2 event destination). They carry
 * only the account's id; its current state is read from Stripe.
 */
async function handleThin(stripe: Stripe, notification: Stripe.V2.Core.EventNotification) {
  if (!notification.type.startsWith("v2.core.account")) return; // recorded in the log, nothing to do
  if (notification.type.startsWith("v2.core.account_")) return; // account links, persons
  const accountId = (notification as { related_object?: { id?: string } | null }).related_object?.id;
  if (!accountId) return;
  if (notification.type === "v2.core.account.closed") return disconnectConnectAccount(accountId);
  await connectAccountChanged(stripe, accountId);
}

/**
 * Settled (now, or by an earlier delivery of the same outcome): send the
 * seat's shares to the club and the coach, if their accounts can receive
 * them. A failure here never fails the webhook: the payment is settled, and
 * the shares stay PENDING for the next attempt (this event's retry, the
 * account's next update, or the owner's next visit to Billing / Earnings).
 */
async function afterSettle(stripe: Stripe, paymentId: string | null | undefined, result: SettleResult) {
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
