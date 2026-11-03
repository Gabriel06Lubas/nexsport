"use server";

import { createId } from "@paralleldrive/cuid2";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { z } from "zod";

import { db } from "@/db";
import { isUniqueViolation } from "@/db/errors";
import { club, planCheckout, profile, subscriptionPlan, user as userTable } from "@/db/schema";
import type { SubscriptionTier } from "@/db/schema/enums";
import { formValues, invalid, type ActionState } from "@/lib/action-state";
import { getClubEntitlements, getCoachEntitlements } from "@/lib/entitlements";
import { plainText } from "@/lib/validation";
import { assertNotImpersonating, requireOnboardedUser, requireUser, type CurrentUser } from "@/modules/auth/dal";
import { homePathFor } from "@/modules/auth/lib/roles";
import { requireClubAccess } from "@/modules/clubs/dal";
import { createClubSchema } from "@/modules/clubs/lib/forms";
import { createPortalSession, ensureCustomer, getStripe } from "@/modules/payments/stripe";
import { createPlanCheckout } from "@/modules/payments/subscriptions";

// Onboarding and plan purchases.
//
//   Step 1  chooseRole: profile + role. Athletes and coaches are onboarded at
//           once (coaches on Free Coach). Choosing "club owner" changes
//           nothing about the account: the user stays an un-onboarded STUDENT
//           and goes on to step 2.
//   Step 2  startClubCheckout / startCoachProCheckout: the purchase is recorded
//           in PlanCheckout (server side), and the user is sent to Stripe.
//   Step 3  The signed webhook verifies the subscription with Stripe and only
//           then creates the club, grants CLUB_OWNER and onboards the user
//           (src/modules/payments/subscriptions.ts). /onboarding/complete waits
//           for it.
//
// Sessions are database sessions: the role is read from the User row on
// every request, so the webhook's role change applies on the next page load,
// with no token to refresh, and nothing on the client can claim a role.

const handleSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_.]{3,30}$/, "3–30 characters: letters, numbers, dots and underscores");

const roleSchema = z.object({
  role: z.enum(["STUDENT", "COACH", "CLUB_OWNER"], { error: "Choose how you'll use nexport" }),
  displayName: plainText({ min: 2, max: 60, label: "display name" }),
  handle: handleSchema,
});

export type OnboardingState = ActionState;

export async function chooseRole(_prev: OnboardingState, formData: FormData): Promise<OnboardingState> {
  const current = await requireUser();
  await assertNotImpersonating();
  if (current.role === "ADMIN" || current.onboarded) redirect(homePathFor(current.role));
  const values = formValues(formData);
  const parsed = roleSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error, values);
  const { role, displayName, handle } = parsed.data;

  try {
    await db.transaction(async (tx) => {
      const [existing] = await tx.select({ id: profile.id }).from(profile).where(eq(profile.userId, current.id));
      if (existing) await tx.update(profile).set({ handle, displayName }).where(eq(profile.id, existing.id));
      else await tx.insert(profile).values({ userId: current.id, handle, displayName });
      if (role === "CLUB_OWNER") return; // nothing granted until Stripe confirms payment
      // `onboardedAt IS NULL` makes this one-shot: it can't be used later to switch roles.
      await tx
        .update(userTable)
        .set({ role, onboardedAt: new Date() })
        .where(and(eq(userTable.id, current.id), isNull(userTable.onboardedAt), ne(userTable.role, "ADMIN")));
    });
  } catch (e) {
    if (isUniqueViolation(e, "Profile_handle_key")) return { error: "Check the highlighted fields.", fieldErrors: { handle: "That handle is taken" }, values };
    throw e;
  }
  if (role === "STUDENT") redirect("/dashboard/student");
  if (role === "COACH") redirect("/onboarding/plan");
  redirect("/onboarding/plan?for=club");
}

// ---------------------------------------------------------------------------
// Plan checkouts
// ---------------------------------------------------------------------------

/** A paid plan that can be sold: active, with a Stripe Price. */
async function sellablePlan(tier: SubscriptionTier) {
  const [plan] = await db
    .select({ name: subscriptionPlan.name, priceId: subscriptionPlan.stripePriceId, isActive: subscriptionPlan.isActive })
    .from(subscriptionPlan)
    .where(eq(subscriptionPlan.tier, tier));
  return plan?.isActive && plan.priceId ? { name: plan.name, priceId: plan.priceId } : null;
}

/** Ends the user's earlier open checkouts of this kind, freeing any club address they reserved. */
async function closeOpenCheckouts(userId: string, kinds: ("CLUB_SIGNUP" | "CLUB_SUBSCRIPTION" | "COACH_PRO")[]) {
  const stripe = getStripe();
  const open = await db
    .update(planCheckout)
    .set({ status: "EXPIRED" })
    .where(and(eq(planCheckout.userId, userId), eq(planCheckout.status, "OPEN"), inArray(planCheckout.kind, kinds)))
    .returning({ sessionId: planCheckout.stripeCheckoutSessionId });
  for (const { sessionId } of open) if (stripe && sessionId) await stripe.checkout.sessions.expire(sessionId).catch(() => undefined);
}

/** Records the purchase, opens Stripe Checkout and redirects there. */
async function goToCheckout(
  buyer: CurrentUser,
  row: Omit<typeof planCheckout.$inferInsert, "id" | "userId" | "updatedAt">,
  priceId: string,
  cancelPath: string,
  values: Record<string, string>,
): Promise<ActionState> {
  const stripe = getStripe()!;
  const checkoutId = createId();
  try {
    await db.insert(planCheckout).values({ ...row, id: checkoutId, userId: buyer.id });
  } catch (e) {
    if (isUniqueViolation(e, "PlanCheckout_open_slug_key")) return { error: "Check the highlighted fields.", fieldErrors: { slug: "That address is taken" }, values };
    throw e;
  }
  let url: string;
  try {
    const customerId = await ensureCustomer(stripe, buyer);
    const session = await createPlanCheckout(stripe, { checkoutId, customerId, priceId, tier: row.tier, cancelPath });
    await db.update(planCheckout).set({ stripeCheckoutSessionId: session.id }).where(eq(planCheckout.id, checkoutId));
    url = session.url;
  } catch (error) {
    console.error("[stripe] plan checkout failed", error);
    await db.update(planCheckout).set({ status: "FAILED", error: "Stripe checkout could not be created" }).where(eq(planCheckout.id, checkoutId));
    return { error: "Payments are unavailable right now. Try again in a moment.", values };
  }
  redirect(url as Route);
}

const clubCheckoutSchema = createClubSchema.extend({
  tier: z.enum(["CLUB_BASIC", "CLUB_ENTERPRISE"], { error: "Choose Club Basic or Club Enterprise" }),
});

/**
 * A new club. Allowed for someone in the club-owner signup (not onboarded
 * yet, a plain STUDENT account with a profile) or an existing club owner
 * adding a club. Athletes and coaches keep their own account type.
 */
export async function startClubCheckout(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const buyer = await requireUser();
  await assertNotImpersonating();
  const signingUp = !buyer.onboarded && buyer.role === "STUDENT";
  if (!signingUp && buyer.role !== "CLUB_OWNER") return { error: "Clubs are run from a club owner account. Sign up with another email to create one." };
  if (signingUp) {
    const [own] = await db.select({ id: profile.id }).from(profile).where(eq(profile.userId, buyer.id));
    if (!own) redirect("/onboarding");
  }
  if (!getStripe()) return { error: "Club sign-up needs online payment, which isn't enabled on this deployment yet." };

  const values = formValues(formData);
  const parsed = clubCheckoutSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error, values);
  const input = parsed.data;
  const plan = await sellablePlan(input.tier);
  if (!plan) return { error: "That plan isn't on sale yet. Try again later.", values };
  const [taken] = await db.select({ id: club.id }).from(club).where(eq(club.slug, input.slug));
  if (taken) return { error: "Check the highlighted fields.", fieldErrors: { slug: "That address is taken" }, values };

  await closeOpenCheckouts(buyer.id, ["CLUB_SIGNUP"]);
  return goToCheckout(
    buyer,
    {
      kind: "CLUB_SIGNUP",
      tier: input.tier,
      clubName: input.name,
      clubSlug: input.slug,
      city: input.city,
      country: input.country,
      timezone: input.timezone,
      currency: input.currency,
    },
    plan.priceId,
    signingUp ? "/onboarding/plan?for=club&checkout=cancelled" : "/dashboard/club?new=1&checkout=cancelled",
    values,
  );
}

/** Free Coach → Pro Coach. */
export async function startCoachProCheckout(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const coach = await requireOnboardedUser();
  await assertNotImpersonating();
  if (coach.role !== "COACH") return { error: "Pro Coach is for coach accounts." };
  if ((await getCoachEntitlements(coach.id)).tier === "PRO_COACH") redirect("/dashboard/coach");
  if (!getStripe()) return { error: "Upgrades need online payment, which isn't enabled on this deployment yet." };
  const plan = await sellablePlan("PRO_COACH");
  if (!plan) return { error: "Pro Coach isn't on sale yet. Try again later." };
  const from = formData.get("from") === "dashboard" ? "/dashboard/coach/availability?checkout=cancelled" : "/onboarding/plan?checkout=cancelled";
  await closeOpenCheckouts(coach.id, ["COACH_PRO"]);
  return goToCheckout(coach, { kind: "COACH_PRO", tier: "PRO_COACH" }, plan.priceId, from, {});
}

/** An existing club without a live subscription (never had one, or it was cancelled) subscribes. */
export async function startClubSubscriptionCheckout(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const access = await requireClubAccess(String(formData.get("clubSlug") ?? ""));
  await assertNotImpersonating();
  if (access.role !== "OWNER") return { error: "Only the club owner can choose the plan." };
  const tier = z.enum(["CLUB_BASIC", "CLUB_ENTERPRISE"]).safeParse(formData.get("tier"));
  if (!tier.success) return { error: "Choose Club Basic or Club Enterprise." };
  const ent = await getClubEntitlements(access.club.id);
  if (ent.status && ent.status !== "CANCELED" && ent.status !== "INCOMPLETE_EXPIRED") {
    return { error: "This club already has a subscription. Manage it with “Manage billing”." };
  }
  if (!getStripe()) return { error: "Online payment isn't enabled on this deployment yet." };
  const plan = await sellablePlan(tier.data);
  if (!plan) return { error: "That plan isn't on sale yet." };
  await closeOpenCheckouts(access.user.id, ["CLUB_SUBSCRIPTION"]);
  return goToCheckout(access.user, { kind: "CLUB_SUBSCRIPTION", tier: tier.data, clubId: access.club.id }, plan.priceId, `/dashboard/${access.club.slug}/billing?checkout=cancelled`, {});
}

/** Stripe's billing portal for the club's subscription: update the card, see invoices, cancel. Owner only. */
export async function openClubBillingPortal(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const access = await requireClubAccess(String(formData.get("clubSlug") ?? ""));
  await assertNotImpersonating();
  if (access.role !== "OWNER") return { error: "Only the club owner can manage the subscription." };
  const stripe = getStripe();
  const ent = await getClubEntitlements(access.club.id);
  if (!stripe || !ent.stripeCustomerId) return { error: "There's no subscription to manage yet." };
  let url: string;
  try {
    url = await createPortalSession(stripe, ent.stripeCustomerId, `/dashboard/${access.club.slug}/billing`);
  } catch (error) {
    console.error("[stripe] club portal failed", error);
    return { error: "Stripe is unavailable right now. Try again in a moment." };
  }
  redirect(url as Route);
}

/** Stripe's billing portal for a coach's Pro subscription. */
export async function openCoachBillingPortal(_prev: ActionState, _formData: FormData): Promise<ActionState> {
  const coach = await requireOnboardedUser();
  await assertNotImpersonating();
  const stripe = getStripe();
  const [row] = await db.select({ customerId: userTable.stripeCustomerId }).from(userTable).where(eq(userTable.id, coach.id));
  if (!stripe || coach.role !== "COACH" || !row?.customerId) return { error: "There's no subscription to manage yet." };
  let url: string;
  try {
    url = await createPortalSession(stripe, row.customerId, "/dashboard/coach/earnings");
  } catch (error) {
    console.error("[stripe] coach portal failed", error);
    return { error: "Stripe is unavailable right now. Try again in a moment." };
  }
  redirect(url as Route);
}
