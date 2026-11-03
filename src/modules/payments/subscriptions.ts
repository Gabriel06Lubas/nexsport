import "server-only";

import { and, eq, sql } from "drizzle-orm";
import type Stripe from "stripe";

import { db } from "@/db";
import { isUniqueViolation } from "@/db/errors";
import { club, clubMember, planCheckout, subscription, subscriptionPlan, user } from "@/db/schema";
import type { SubscriptionTier } from "@/db/schema/enums";

import { appUrl } from "./stripe";

// SaaS subscriptions: the Checkout that sells a plan, and what the webhook
// does when Stripe confirms or changes one.
//
// The trust boundary: a PlanCheckout row is written by our server before the
// customer leaves for Stripe, with everything the purchase will create. The
// webhook (signature-verified) only carries its id. Provisioning re-checks
// with Stripe's API that the subscription exists, is paid (active or
// trialing), belongs to this customer and is for this plan's Price, and then
// creates rows from the PlanCheckout, not from anything in the event.

type SubscriptionStatus = "INCOMPLETE" | "INCOMPLETE_EXPIRED" | "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELED" | "UNPAID" | "PAUSED";

export function mapStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
  return status.toUpperCase() as SubscriptionStatus;
}

/** Period bounds: on the subscription in older API versions, on its items in newer ones. */
function periodOf(sub: Stripe.Subscription) {
  const item = sub.items.data[0] as (Stripe.SubscriptionItem & { current_period_start?: number; current_period_end?: number }) | undefined;
  const legacy = sub as Stripe.Subscription & { current_period_start?: number; current_period_end?: number };
  const start = item?.current_period_start ?? legacy.current_period_start ?? sub.start_date;
  const end = item?.current_period_end ?? legacy.current_period_end ?? start;
  return { start: new Date(start * 1000), end: new Date(end * 1000) };
}

const customerIdOf = (sub: Stripe.Subscription) => (typeof sub.customer === "string" ? sub.customer : sub.customer.id);

/** The Stripe Checkout that sells a plan; success returns to /onboarding/complete. */
export async function createPlanCheckout(
  stripe: Stripe,
  input: { checkoutId: string; customerId: string; priceId: string; tier: SubscriptionTier; cancelPath: string },
) {
  const session = await stripe.checkout.sessions.create(
    {
      mode: "subscription",
      customer: input.customerId,
      client_reference_id: input.checkoutId,
      metadata: { planCheckoutId: input.checkoutId, tier: input.tier },
      subscription_data: { metadata: { planCheckoutId: input.checkoutId, tier: input.tier } },
      line_items: [{ price: input.priceId, quantity: 1 }],
      success_url: appUrl(`/onboarding/complete?checkout=${input.checkoutId}`),
      cancel_url: appUrl(input.cancelPath),
    },
    { idempotencyKey: `plan-checkout-${input.checkoutId}` },
  );
  if (!session.url) throw new Error("Stripe returned a Checkout Session without a URL");
  return { id: session.id, url: session.url };
}

export type ProvisionResult = "provisioned" | "already-done" | "unknown" | "rejected";

/**
 * checkout.session.completed for a subscription: verify, then provision.
 *   CLUB_SIGNUP        → Club (ACTIVE) + OWNER membership + Subscription;
 *                        the buyer becomes CLUB_OWNER and is onboarded.
 *   CLUB_SUBSCRIPTION  → Subscription for the existing club.
 *   COACH_PRO          → Subscription (PRO_COACH) for the coach.
 * Idempotent: the PlanCheckout moves OPEN → COMPLETED once, under a row lock.
 */
export async function provisionFromCheckout(stripe: Stripe, session: Stripe.Checkout.Session): Promise<ProvisionResult> {
  const checkoutId = session.metadata?.planCheckoutId ?? session.client_reference_id;
  if (!checkoutId) return "unknown";
  const [pending] = await db.select().from(planCheckout).where(eq(planCheckout.id, checkoutId));
  if (!pending) return "unknown";
  if (pending.status === "COMPLETED") return "already-done";

  const reject = async (reason: string) => {
    await db.update(planCheckout).set({ status: "FAILED", error: reason.slice(0, 500) }).where(and(eq(planCheckout.id, checkoutId), eq(planCheckout.status, "OPEN")));
    console.error(`[plans] checkout ${checkoutId} rejected: ${reason}`);
    return "rejected" as const;
  };

  // The Checkout Session must be the one this PlanCheckout created.
  // Ignored rather than failed, so it can't spoil the real one.
  if (pending.stripeCheckoutSessionId && pending.stripeCheckoutSessionId !== session.id) {
    console.error(`[plans] checkout ${checkoutId}: ignoring session ${session.id}, expected ${pending.stripeCheckoutSessionId}`);
    return "unknown";
  }
  const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
  if (session.status !== "complete" || !subscriptionId) return reject("Checkout not complete");
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  const status = mapStatus(sub.status);
  if (status !== "ACTIVE" && status !== "TRIALING") return reject(`Subscription ${sub.id} is ${sub.status}`);

  const [plan] = await db.select().from(subscriptionPlan).where(eq(subscriptionPlan.tier, pending.tier));
  const price = sub.items.data[0]?.price;
  if (!plan?.stripePriceId || price?.id !== plan.stripePriceId) return reject(`Subscription ${sub.id} is not for the ${pending.tier} Price`);
  const [buyer] = await db.select({ id: user.id, role: user.role, customerId: user.stripeCustomerId }).from(user).where(eq(user.id, pending.userId));
  if (!buyer || buyer.customerId !== customerIdOf(sub)) return reject(`Subscription ${sub.id} belongs to another customer`);
  if (buyer.role === "ADMIN") return reject("Admins can't buy plans");

  const period = periodOf(sub);
  const subscriptionRow = {
    tier: pending.tier,
    status,
    stripeCustomerId: customerIdOf(sub),
    stripeSubscriptionId: sub.id,
    stripePriceId: price.id,
    monthlyAmount: price.unit_amount ?? plan.monthlyPriceAmount,
    currency: price.currency,
    platformFeeBps: plan.platformFeeBps,
    currentPeriodStart: period.start,
    currentPeriodEnd: period.end,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
  };

  return db.transaction(async (tx) => {
    const [locked] = await tx.select().from(planCheckout).where(eq(planCheckout.id, checkoutId)).for("update");
    if (!locked || locked.status === "COMPLETED") return "already-done" as const;

    let clubId: string | null = locked.clubId;
    if (locked.kind === "CLUB_SIGNUP") {
      // The reserved address, or a suffixed one if a club took it meanwhile.
      let slug = locked.clubSlug!;
      const [taken] = await tx.select({ id: club.id }).from(club).where(eq(club.slug, slug));
      if (taken) slug = `${slug.slice(0, 40)}-${checkoutId.slice(-6)}`;
      const [created] = await tx
        .insert(club)
        .values({
          slug,
          name: locked.clubName!,
          city: locked.city,
          country: locked.country!,
          timezone: locked.timezone!,
          currency: locked.currency!,
          status: "ACTIVE",
          ownerId: locked.userId,
          stripeCustomerId: subscriptionRow.stripeCustomerId,
        })
        .returning({ id: club.id });
      clubId = created!.id;
      await tx.insert(clubMember).values({ clubId, userId: locked.userId, role: "OWNER", status: "ACTIVE", joinedAt: new Date() });
      await tx.insert(subscription).values({ ...subscriptionRow, clubId });
      // The role is granted here, and only here: after Stripe confirmed payment.
      await tx
        .update(user)
        .set({ role: "CLUB_OWNER", onboardedAt: sql`COALESCE(${user.onboardedAt}, now())`, activeClubId: clubId })
        .where(and(eq(user.id, locked.userId), sql`${user.role} IN ('STUDENT', 'CLUB_OWNER')`));
    } else if (locked.kind === "CLUB_SUBSCRIPTION") {
      await tx.insert(subscription).values({ ...subscriptionRow, clubId: clubId! });
      await tx.update(club).set({ status: "ACTIVE" }).where(and(eq(club.id, clubId!), eq(club.status, "PENDING_SETUP")));
    } else {
      await tx.insert(subscription).values({ ...subscriptionRow, userId: locked.userId });
    }

    await tx
      .update(planCheckout)
      .set({ status: "COMPLETED", completedAt: sql`now()`, clubId, stripeSubscriptionId: sub.id, error: null })
      .where(eq(planCheckout.id, checkoutId));
    return "provisioned" as const;
  }).catch(async (error) => {
    // Already has a live subscription (Subscription_one_live_per_*): don't
    // create a second one; flag it for support instead of failing silently.
    if (isUniqueViolation(error)) return reject(`Could not provision: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  });
}

/** checkout.session.expired for a plan: release the reserved club address. */
export async function expirePlanCheckout(session: Stripe.Checkout.Session) {
  const checkoutId = session.metadata?.planCheckoutId ?? session.client_reference_id;
  if (!checkoutId) return 0;
  const rows = await db
    .update(planCheckout)
    .set({ status: "EXPIRED" })
    .where(and(eq(planCheckout.id, checkoutId), eq(planCheckout.status, "OPEN")))
    .returning({ id: planCheckout.id });
  return rows.length;
}

/**
 * customer.subscription.created / updated / deleted: keep our row in step
 * with Stripe (status, period, cancellation, a plan change made in the
 * portal). This is what turns a club's access off when a payment fails
 * (PAST_DUE) or the subscription ends (CANCELED), and back on when fixed.
 */
export async function syncSubscription(sub: Stripe.Subscription) {
  const period = periodOf(sub);
  const price = sub.items.data[0]?.price;
  const [plan] = price ? await db.select({ tier: subscriptionPlan.tier, fee: subscriptionPlan.platformFeeBps }).from(subscriptionPlan).where(eq(subscriptionPlan.stripePriceId, price.id)) : [];
  const updated = await db
    .update(subscription)
    .set({
      status: mapStatus(sub.status),
      currentPeriodStart: period.start,
      currentPeriodEnd: period.end,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
      ...(price ? { stripePriceId: price.id, monthlyAmount: price.unit_amount ?? 0, currency: price.currency } : {}),
      ...(plan ? { tier: plan.tier, platformFeeBps: plan.fee } : {}),
    })
    .where(eq(subscription.stripeSubscriptionId, sub.id))
    .returning({ id: subscription.id });
  return updated.length;
}
