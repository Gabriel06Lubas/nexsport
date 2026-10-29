import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { auth } from "./auth";
import { hashSessionToken } from "./lib/session-policy";
import { canAccessArea, homePathFor, type DashboardArea } from "./lib/roles";

// Data Access Layer: the one place that decides who the current user is.
// Every protected page and every server action calls one of these; the proxy
// only does a cheap cookie-presence redirect and is never trusted on its own.

export const SESSION_COOKIE_NAMES = ["__Secure-authjs.session-token", "authjs.session-token"] as const;

/** The signed-in user, or null. Deduplicated per request via React cache. */
export const getCurrentUser = cache(async () => {
  const session = await auth();
  return session?.user ?? null;
});

export type CurrentUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

/**
 * Signed in, but the email may still be unconfirmed. Only for the
 * confirm-your-email step itself; everything else uses requireUser().
 */
export async function requireSignedInUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Signed in with a confirmed email: the default gate for the app. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await requireSignedInUser();
  if (!user.emailConfirmed) redirect("/verify-email");
  return user;
}

export async function requireOnboardedUser(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!user.onboarded) redirect("/onboarding");
  return user;
}

/** Signed in, onboarded, and allowed in this dashboard area. */
export async function requireArea(area: DashboardArea): Promise<CurrentUser> {
  const user = await requireOnboardedUser();
  if (!canAccessArea(user.role, area)) redirect(homePathFor(user.role));
  return user;
}

/** Hash of the session token in this request's cookie, to mark "this device". */
export const getCurrentSessionTokenHash = cache(async () => {
  const jar = await cookies();
  for (const name of SESSION_COOKIE_NAMES) {
    const token = jar.get(name)?.value;
    if (token) return hashSessionToken(token);
  }
  return null;
});
