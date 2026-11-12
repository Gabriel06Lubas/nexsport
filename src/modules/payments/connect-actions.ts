"use server";

import type { Route } from "next";
import { redirect } from "next/navigation";
import { z } from "zod";

import type { ActionState } from "@/lib/action-state";
import { assertNotImpersonating, requireOnboardedUser } from "@/modules/auth/dal";
import { requireClubAccess } from "@/modules/clubs/dal";
import { countryOptions } from "@/modules/onboarding/club-options";

import { createDashboardLink, createOnboardingLink, ensureConnectAccount, getConnectAccountFor, type ConnectOwner } from "./connect";
import { DISCONNECTED } from "./lib/connect-status";
import { getStripe } from "./stripe";

// "Connect with Stripe" for clubs (Billing) and coaches (Earnings). The
// connected account is a legal entity that receives money, so only the club
// owner (not staff, not an admin impersonating) and the coach themselves can
// create it or open its dashboard.

const notEnabled: ActionState = { error: "Online payments aren't enabled on this deployment yet." };

function stripeFailure(error: unknown, what: string): ActionState {
  const e = error as { type?: string; message?: string; param?: string } | null;
  console.error(`[connect] ${what} failed`, error);
  if (e?.type === "StripeInvalidRequestError" && e.param === "country") {
    return { error: "Stripe can't open accounts in that country yet. Pick another country, or contact support." };
  }
  return { error: "Stripe is unavailable right now. Try again in a moment." };
}

async function clubOwner(formData: FormData): Promise<ConnectOwner | ActionState> {
  const access = await requireClubAccess(String(formData.get("clubSlug") ?? ""));
  await assertNotImpersonating();
  if (access.role !== "OWNER") return { error: "Only the club owner can connect the club's Stripe account." };
  if (access.readOnly) return { error: "This club is suspended by nexport, so nothing can be changed. Contact support." };
  return { kind: "club", clubId: access.club.id, slug: access.club.slug, name: access.club.name, country: access.club.country, email: access.user.email };
}

/** Billing → "Connect with Stripe" / "Continue setup" / "Update details": Stripe-hosted onboarding. */
export async function startClubConnect(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const owner = await clubOwner(formData);
  if (!("kind" in owner)) return owner;
  const stripe = getStripe();
  if (!stripe) return notEnabled;
  let url: string;
  try {
    const account = await ensureConnectAccount(stripe, owner);
    url = await createOnboardingLink(stripe, account.stripeAccountId, owner);
  } catch (error) {
    return stripeFailure(error, "club onboarding");
  }
  redirect(url as Route);
}

/** Billing → "Open Stripe dashboard": payouts, bank account, tax details. */
export async function openClubStripeDashboard(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const owner = await clubOwner(formData);
  if (!("kind" in owner)) return owner;
  return openDashboard(owner);
}

const coachCountry = z.object({ country: z.enum(countryOptions.map((c) => c.value) as [string, ...string[]], { error: "Pick the country you're based in" }) });

async function coachOwner(country?: string): Promise<ConnectOwner | ActionState> {
  const coach = await requireOnboardedUser();
  await assertNotImpersonating();
  if (coach.role !== "COACH") return { error: "Payouts are for coach accounts." };
  return { kind: "coach", userId: coach.id, name: coach.name ?? null, country: country ?? "", email: coach.email };
}

/**
 * Earnings → "Connect with Stripe" (first time: with the coach's country,
 * which Stripe can't change later) / "Continue setup" / "Update details".
 */
export async function startCoachConnect(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const owner = await coachOwner();
  if (!("kind" in owner)) return owner;
  const stripe = getStripe();
  if (!stripe) return notEnabled;
  const found = await getConnectAccountFor(owner);
  // A disconnected account is replaced by a new one, for which the country is asked again.
  const existing = found && found.disabledReason !== DISCONNECTED ? found : null;
  if (!existing) {
    const parsed = coachCountry.safeParse({ country: formData.get("country") });
    if (!parsed.success) return { error: "Check the highlighted fields.", fieldErrors: { country: parsed.error.issues[0]!.message } };
    owner.country = parsed.data.country;
  }
  let url: string;
  try {
    const account = existing ?? (await ensureConnectAccount(stripe, owner));
    url = await createOnboardingLink(stripe, account.stripeAccountId, owner);
  } catch (error) {
    return stripeFailure(error, "coach onboarding");
  }
  redirect(url as Route);
}

export async function openCoachStripeDashboard(_prev: ActionState, _formData: FormData): Promise<ActionState> {
  const owner = await coachOwner();
  if (!("kind" in owner)) return owner;
  return openDashboard(owner);
}

async function openDashboard(owner: ConnectOwner): Promise<ActionState> {
  const stripe = getStripe();
  if (!stripe) return notEnabled;
  const account = await getConnectAccountFor(owner);
  if (!account?.detailsSubmitted) return { error: "Finish setting up your Stripe account first." };
  let url: string;
  try {
    url = await createDashboardLink(stripe, account.stripeAccountId);
  } catch (error) {
    return stripeFailure(error, "dashboard link");
  }
  redirect(url as Route);
}
