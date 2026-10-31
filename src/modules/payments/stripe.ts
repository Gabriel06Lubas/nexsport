import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import Stripe from "stripe";

import { db } from "@/db";
import { user } from "@/db/schema";

// The Stripe client and the few calls the app makes. Stripe is optional:
// without STRIPE_SECRET_KEY the app runs, paid seats are paid at the club,
// and payment-method screens say so. Every money-moving call carries an
// idempotency key, so a retried request never charges or refunds twice.

let client: Stripe | null = null;

/** The Stripe client, or null when Stripe isn't configured. */
export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) return null;
  if (!client) {
    // STRIPE_API_BASE points the SDK at stripe-mock or the e2e mock. Never in production.
    const base = process.env.NODE_ENV !== "production" && process.env.STRIPE_API_BASE ? new URL(process.env.STRIPE_API_BASE) : null;
    client = new Stripe(key, {
      maxNetworkRetries: 2,
      appInfo: { name: "nexport" },
      ...(base ? { host: base.hostname, port: base.port, protocol: base.protocol === "http:" ? "http" : "https" } : {}),
    });
  }
  return client;
}

export const stripeConfigured = () => getStripe() !== null;

/** The public base URL for links Stripe sends people back to (never the request's Host header). */
export function appUrl(path: string): string {
  const base = process.env.AUTH_URL?.trim() || "http://localhost:3000";
  return new URL(path, base).toString();
}

/** The user's Stripe Customer, created on first use. */
export async function ensureCustomer(stripe: Stripe, u: { id: string; email: string; name?: string | null }): Promise<string> {
  const [row] = await db.select({ customerId: user.stripeCustomerId }).from(user).where(eq(user.id, u.id));
  if (row?.customerId) return row.customerId;
  const customer = await stripe.customers.create(
    { email: u.email, name: u.name ?? undefined, metadata: { userId: u.id } },
    { idempotencyKey: `customer-${u.id}` },
  );
  // Only set it if still empty; a concurrent request may have won.
  await db.update(user).set({ stripeCustomerId: customer.id }).where(and(eq(user.id, u.id), isNull(user.stripeCustomerId)));
  const [after] = await db.select({ customerId: user.stripeCustomerId }).from(user).where(eq(user.id, u.id));
  return after?.customerId ?? customer.id;
}

/** Stripe needs at least 30 minutes; the seat is held for as long. */
export const CHECKOUT_HOLD_MINUTES = 35;

export async function createSeatCheckout(
  stripe: Stripe,
  input: {
    paymentId: string;
    idempotencyKey: string;
    customerId: string;
    amount: number;
    currency: string;
    description: string;
    transferGroup: string;
    expiresAt: Date;
    successPath: string;
    cancelPath: string;
  },
) {
  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      customer: input.customerId,
      client_reference_id: input.paymentId,
      metadata: { paymentId: input.paymentId },
      line_items: [{ quantity: 1, price_data: { currency: input.currency, unit_amount: input.amount, product_data: { name: input.description } } }],
      payment_intent_data: { transfer_group: input.transferGroup, metadata: { paymentId: input.paymentId } },
      expires_at: Math.floor(input.expiresAt.getTime() / 1000),
      success_url: appUrl(input.successPath),
      cancel_url: appUrl(input.cancelPath),
    },
    { idempotencyKey: `checkout-${input.idempotencyKey}` },
  );
  if (!session.url) throw new Error("Stripe returned a Checkout Session without a URL");
  return { id: session.id, url: session.url };
}

/**
 * Refunds a payment. For a destination charge (court rentals: the money went
 * straight to the club's connected account), the transfer and the platform
 * fee are reversed in proportion, so the club and nexport give back their
 * parts instead of the platform paying the whole refund.
 */
export async function refundPayment(stripe: Stripe, input: { paymentId: string; paymentIntentId: string; amount: number; destinationCharge?: boolean }) {
  return stripe.refunds.create(
    {
      payment_intent: input.paymentIntentId,
      amount: input.amount,
      reason: "requested_by_customer",
      metadata: { paymentId: input.paymentId },
      ...(input.destinationCharge ? { reverse_transfer: true, refund_application_fee: true } : {}),
    },
    { idempotencyKey: `refund-${input.paymentId}-${input.amount}` },
  );
}

/** How long an unpaid court booking holds its slot. */
export const COURT_HOLD_MINUTES = 15;

/**
 * A PaymentIntent for a court booking, as a destination charge: the customer
 * pays the club's connected account directly (on its behalf, so the club is
 * the merchant of record), and nexport keeps `applicationFee`. Stripe's
 * processing fee comes out of nexport's fee, so the club receives exactly
 * amount − applicationFee.
 */
export async function createCourtPaymentIntent(
  stripe: Stripe,
  input: {
    paymentId: string;
    bookingId: string;
    clubId: string;
    customerId: string;
    destination: string;
    amount: number;
    applicationFee: number;
    currency: string;
    description: string;
    receiptEmail: string;
  },
) {
  return stripe.paymentIntents.create(
    {
      amount: input.amount,
      currency: input.currency,
      customer: input.customerId,
      automatic_payment_methods: { enabled: true },
      application_fee_amount: input.applicationFee,
      transfer_data: { destination: input.destination },
      on_behalf_of: input.destination,
      transfer_group: `booking_${input.bookingId}`,
      description: input.description,
      receipt_email: input.receiptEmail,
      metadata: { paymentId: input.paymentId, facilityBookingId: input.bookingId, clubId: input.clubId },
    },
    { idempotencyKey: `pi-${input.paymentId}` },
  );
}

export async function listCards(stripe: Stripe, customerId: string) {
  const list = await stripe.customers.listPaymentMethods(customerId, { type: "card", limit: 10 });
  return list.data.map((pm) => ({ id: pm.id, brand: pm.card?.brand ?? "card", last4: pm.card?.last4 ?? "····", expMonth: pm.card?.exp_month, expYear: pm.card?.exp_year }));
}

export async function createPortalSession(stripe: Stripe, customerId: string, returnPath: string) {
  const portal = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: appUrl(returnPath) });
  return portal.url;
}
