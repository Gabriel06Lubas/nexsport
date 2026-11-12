import type { NextRequest } from "next/server";

import { assertNotImpersonating } from "@/modules/auth/dal";
import { requireClubAccess } from "@/modules/clubs/dal";
import { createOnboardingLink, getConnectAccountFor, type ConnectOwner } from "@/modules/payments/connect";
import { getStripe } from "@/modules/payments/stripe";

// GET /dashboard/:clubSlug/billing/connect: Stripe's refresh_url. Onboarding
// links are single-use and expire within minutes; when one has, Stripe sends
// the owner here and we hand them a fresh one. Only for the club owner, and
// only for an account that already exists (creating one is a POST, from
// "Connect with Stripe").
export async function GET(request: NextRequest, { params }: { params: Promise<{ clubSlug: string }> }) {
  const { clubSlug } = await params;
  const access = await requireClubAccess(clubSlug);
  await assertNotImpersonating();
  const billing = new URL(`/dashboard/${access.club.slug}/billing`, request.url);
  const stripe = getStripe();
  if (access.role !== "OWNER" || access.readOnly || !stripe) return Response.redirect(billing, 303);
  const owner: ConnectOwner = { kind: "club", clubId: access.club.id, slug: access.club.slug, name: access.club.name, country: access.club.country, email: access.user.email };
  const account = await getConnectAccountFor(owner);
  if (!account) return Response.redirect(billing, 303);
  try {
    return Response.redirect(await createOnboardingLink(stripe, account.stripeAccountId, owner), 303);
  } catch (error) {
    console.error("[connect] refresh link failed", error);
    billing.searchParams.set("connect", "error");
    return Response.redirect(billing, 303);
  }
}
