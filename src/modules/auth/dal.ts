import "server-only";

import { and, eq, isNotNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";

import { db } from "@/db";
import { session, user } from "@/db/schema";

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

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

const impersonator = alias(user, "impersonator");

/** If this request runs inside an impersonation session: who is impersonating. */
export const getImpersonation = cache(async () => {
  const tokenHash = await getCurrentSessionTokenHash();
  if (!tokenHash) return null;
  const [row] = await db
    .select({ adminId: impersonator.id, adminEmail: impersonator.email, userId: session.userId, expires: session.expires })
    .from(session)
    .innerJoin(impersonator, eq(session.impersonatorId, impersonator.id))
    .where(and(eq(session.tokenHash, tokenHash), isNotNull(session.impersonatorId)))
    .limit(1);
  return row ?? null;
});

/**
 * The admin area's gate. Anyone else (including an admin who is currently
 * impersonating someone) gets a plain 404, so the area doesn't reveal itself.
 */
export async function requireAdmin(): Promise<CurrentUser> {
  const current = await requireUser();
  if (current.role !== "ADMIN" || (await getImpersonation())) notFound();
  return current;
}

/**
 * For actions that change how someone signs in or who they are (linking
 * providers, revoking sessions, onboarding, email codes): not allowed while
 * an admin is impersonating the account.
 */
export async function assertNotImpersonating(): Promise<void> {
  if (await getImpersonation()) redirect("/dashboard");
}
