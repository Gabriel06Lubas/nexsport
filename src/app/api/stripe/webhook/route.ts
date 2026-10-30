import { eq, sql } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { db } from "@/db";
import { paymentTransaction, stripeWebhookEvent } from "@/db/schema";
import { releaseSeatHold, settleSeatPayment } from "@/modules/payments/settle";
import { getStripe, refundPayment } from "@/modules/payments/stripe";

// POST /api/stripe/webhook. Only events signed with STRIPE_WEBHOOK_SECRET
// are accepted. Each event is recorded in StripeWebhookEvent (the admin's
// log) before it's handled; one already processed is acknowledged and
// skipped, so Stripe's retries are harmless. A failure is recorded and
// answered with 500, so Stripe retries it.
export async function POST(request: NextRequest) {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!stripe || !secret) return new Response("Stripe is not configured", { status: 404 });

  const signature = request.headers.get("stripe-signature");
  const body = await request.text();
  let event;
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
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
      {
        const result = await settleSeatPayment(event.data.object);
        if (typeof result === "object") {
          await refundPayment(stripe, result.refund);
          await db
            .update(paymentTransaction)
            .set({ refundStatus: "REFUNDED", refundedAmount: result.refund.amount, refundedAt: sql`now()` })
            .where(eq(paymentTransaction.id, result.refund.paymentId));
        }
        break;
      }
      case "checkout.session.expired":
        await releaseSeatHold(event.data.object.id);
        break;
      default:
        break; // recorded, nothing to do
    }
    await db.update(stripeWebhookEvent).set({ processedAt: sql`now()`, error: null }).where(eq(stripeWebhookEvent.id, event.id));
    return Response.json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.update(stripeWebhookEvent).set({ error: message.slice(0, 500) }).where(eq(stripeWebhookEvent.id, event.id));
    return new Response("Webhook handling failed", { status: 500 });
  }
}
