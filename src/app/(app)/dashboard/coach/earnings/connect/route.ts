import type { NextRequest } from "next/server";

import { assertNotImpersonating } from "@/modules/auth/dal";
import { requireCoach } from "@/modules/coaching/dal";
import { createOnboardingLink, getConnectAccountFor, type ConnectOwner } from "@/modules/payments/connect";
import { getStripe } from "@/modules/payments/stripe";

// GET /dashboard/coach/earnings/connect: Stripe's refresh_url for a coach's
// onboarding (see the club route). Only for the coach's existing account.
export async function GET(request: NextRequest) {
  const coach = await requireCoach();
  await assertNotImpersonating();
  const earnings = new URL("/dashboard/coach/earnings", request.url);
  const stripe = getStripe();
  if (!stripe) return Response.redirect(earnings, 303);
  const owner: ConnectOwner = { kind: "coach", userId: coach.id, name: coach.name ?? null, country: "", email: coach.email };
  const account = await getConnectAccountFor(owner);
  if (!account) return Response.redirect(earnings, 303);
  try {
    return Response.redirect(await createOnboardingLink(stripe, account.stripeAccountId, owner), 303);
  } catch (error) {
    console.error("[connect] refresh link failed", error);
    earnings.searchParams.set("connect", "error");
    return Response.redirect(earnings, 303);
  }
}
