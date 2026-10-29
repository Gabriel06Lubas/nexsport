"use server";

import { and, eq, isNull, ne } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";

import { db } from "@/db";
import { isUniqueViolation } from "@/db/errors";
import { idSchema, plainText } from "@/lib/validation";
import { account, profile, session, user as userTable } from "@/db/schema";

import { signIn, signOut } from "./auth";
import { assertNotImpersonating, getCurrentSessionTokenHash, requireUser } from "./dal";
import { safeCallbackUrl } from "./lib/redirects";
import { homePathFor, selfAssignableRoles } from "./lib/roles";
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

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

const onboardingSchema = z.object({
  role: z.enum(selfAssignableRoles),
  displayName: plainText({ min: 2, max: 60, label: "display name" }),
  handle: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_.]{3,30}$/, "3–30 characters: letters, numbers, dots and underscores"),
});

export type OnboardingState = {
  errors?: Partial<Record<keyof z.infer<typeof onboardingSchema> | "form", string>>;
  values?: Partial<Record<keyof z.infer<typeof onboardingSchema>, string>>;
};

export async function completeOnboarding(_prev: OnboardingState, formData: FormData): Promise<OnboardingState> {
  const user = await requireUser();
  await assertNotImpersonating();
  const raw = {
    role: String(formData.get("role") ?? ""),
    displayName: String(formData.get("displayName") ?? ""),
    handle: String(formData.get("handle") ?? ""),
  };
  const parsed = onboardingSchema.safeParse(raw);
  if (!parsed.success) {
    const errors: OnboardingState["errors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof typeof raw;
      errors[key] ??= issue.message;
    }
    return { errors, values: raw };
  }

  const { role, displayName, handle } = parsed.data;
  try {
    await db.transaction(async (tx) => {
      // `onboardedAt IS NULL` makes this a one-shot: re-submitting the form
      // later can't be used to switch roles (e.g. student → club owner).
      const updated = await tx
        .update(userTable)
        .set({ role, onboardedAt: new Date() })
        // Never for admins: onboarding must not be able to change their role.
        .where(and(eq(userTable.id, user.id), isNull(userTable.onboardedAt), ne(userTable.role, "ADMIN")))
        .returning({ id: userTable.id });
      if (updated.length === 0) return;
      await tx.insert(profile).values({ userId: user.id, handle, displayName });
    });
  } catch (e) {
    if (isUniqueViolation(e, "Profile_handle_key")) {
      return { errors: { handle: "That handle is taken" }, values: raw };
    }
    throw e;
  }
  redirect(homePathFor(role));
}
