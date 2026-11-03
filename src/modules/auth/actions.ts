"use server";

import { and, eq, ne } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";

import { db } from "@/db";
import { idSchema } from "@/lib/validation";
import { account, session } from "@/db/schema";

import { signIn, signOut } from "./auth";
import { assertNotImpersonating, getCurrentSessionTokenHash, requireUser } from "./dal";
import { safeCallbackUrl } from "./lib/redirects";
import { configuredProviderIds, type ProviderId } from "./providers";

// Every action re-authenticates through the DAL. Server Actions are public
// HTTP endpoints, so a hidden button is never a security boundary.

export async function signInWithProvider(provider: ProviderId, callbackUrl?: string) {
  if (!configuredProviderIds().includes(provider)) redirect("/login?error=Configuration");
  // Signed in already = linking a provider to this account: never as an impersonator.
  await assertNotImpersonating();
  await signIn(provider, { redirectTo: safeCallbackUrl(callbackUrl) });
}

export async function signOutAction() {
  await signOut({ redirectTo: "/login?signedOut=1" });
}

/** Ends every session except the one making this request. */
export async function signOutOtherDevices() {
  const user = await requireUser();
  await assertNotImpersonating();
  const current = await getCurrentSessionTokenHash();
  await db
    .delete(session)
    .where(and(eq(session.userId, user.id), current ? ne(session.tokenHash, current) : undefined));
  redirect("/dashboard/settings/security?revoked=others");
}

/** Ends every session, including this one. */
export async function signOutEverywhere() {
  const user = await requireUser();
  await assertNotImpersonating();
  await db.delete(session).where(eq(session.userId, user.id));
  redirect("/login?signedOut=all");
}

export async function revokeSession(formData: FormData) {
  const user = await requireUser();
  await assertNotImpersonating();
  const sessionId = idSchema.parse(formData.get("sessionId"));
  // Scoped to the caller: a user can never revoke someone else's session.
  await db.delete(session).where(and(eq(session.id, sessionId), eq(session.userId, user.id)));
  redirect("/dashboard/settings/security?revoked=one");
}

export async function unlinkProvider(formData: FormData) {
  const user = await requireUser();
  await assertNotImpersonating();
  const provider = z.enum(["google", "apple"]).parse(formData.get("provider"));
  const accounts = await db.select({ provider: account.provider }).from(account).where(eq(account.userId, user.id));
  // Never strand an account: with OAuth-only sign-in, the last linked
  // provider is the only way back in.
  if (accounts.length <= 1) redirect("/dashboard/settings/security?error=last-provider");
  await db.delete(account).where(and(eq(account.userId, user.id), eq(account.provider, provider)));
  redirect("/dashboard/settings/security?unlinked=1");
}

// Onboarding (role and plan selection) lives in src/modules/onboarding/actions.ts.
