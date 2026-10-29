"use server";

import { and, eq, isNull } from "drizzle-orm";
import type { Route } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { db } from "@/db";
import { session, user as userTable } from "@/db/schema";

import { assertNotImpersonating, getCurrentSessionTokenHash, requireSignedInUser } from "./dal";
import {
  activeVerifyCodeFor,
  checkEmailCode,
  issueEmailCode,
  pendingSignInCookieName,
  pendingSignInEmail,
  pendingSignInId,
  type CheckResult,
  type IssueResult,
} from "./email-code";
import { CODE_TTL_SECONDS, codeSchema, emailSchema } from "./lib/email-code-policy";
import { safeCallbackUrl } from "./lib/redirects";
import { homePathFor } from "./lib/roles";
import { useSecureCookies, startSession } from "./session-cookie";

// Server actions for email codes. Every value from a form is parsed with a
// strict schema first; nothing user-typed is used unvalidated, echoed into
// HTML or spliced into SQL (Drizzle parameterises every query).

export type CodeFormState = { error?: string; notice?: string; email?: string };

const unavailable = () =>
  process.env.NODE_ENV === "production"
    ? "Something went wrong on our side. Please try again in a minute."
    : "Couldn't reach the database. Is `npm run db:up` running, and have you run `npm run db:migrate`?";

/** issueEmailCode, turning an unreachable/broken database into a form message instead of a crash. */
async function issueOrExplain(input: Parameters<typeof issueEmailCode>[0]): Promise<IssueResult | { ok: false; reason: "unavailable" }> {
  try {
    return await issueEmailCode(input);
  } catch (error) {
    console.error("[email-code] could not issue a code:", error instanceof Error ? error.message : error);
    return { ok: false, reason: "unavailable" };
  }
}

function issueError(result: Exclude<IssueResult, { ok: true }> | { ok: false; reason: "unavailable" }): string {
  if (result.reason === "unavailable") return unavailable();
  switch (result.reason) {
    case "cooldown":
      return `Please wait ${result.retryAfterSeconds} seconds before asking for another code.`;
    case "rate_limited":
      return "Too many codes have been requested. Please try again in an hour.";
    case "send_failed":
      return "We couldn't send the email just now. Please try again in a minute.";
  }
}

function checkError(result: Exclude<CheckResult, { ok: true }>): string {
  return result.reason === "invalid"
    ? `That code isn't right. ${result.attemptsLeft} ${result.attemptsLeft === 1 ? "attempt" : "attempts"} left.`
    : "That code has expired or was tried too many times. Request a new one.";
}

// ---------------------------------------------------------------------------
// "Continue with email": sign in (or sign up) with a code
// ---------------------------------------------------------------------------

export async function requestSignInCode(_prev: CodeFormState, formData: FormData): Promise<CodeFormState> {
  const raw = formData.get("email");
  const parsed = emailSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message, email: typeof raw === "string" ? raw.slice(0, 254) : "" };
  }

  // Same response whether or not an account exists for this address, so the
  // form can't be used to discover who is registered.
  const result = await issueOrExplain({ purpose: "SIGN_IN", email: parsed.data });
  if (!result.ok) return { error: issueError(result), email: parsed.data };

  await setPendingCookie(result.id);
  const callbackUrl = safeCallbackUrl(formData.get("callbackUrl"));
  redirect(`/login/verify?callbackUrl=${encodeURIComponent(callbackUrl)}` as Route);
}

async function setPendingCookie(codeId: string) {
  (await cookies()).set(pendingSignInCookieName(), codeId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: useSecureCookies(),
    maxAge: CODE_TTL_SECONDS,
  });
}

/** Sends a fresh code to the address of this browser's pending sign-in (never to a form field). */
export async function resendSignInCode(_prev: CodeFormState): Promise<CodeFormState> {
  const email = await pendingSignInEmail();
  if (!email) return { error: "This sign-in has expired. Enter your email again to get a new code." };
  const result = await issueOrExplain({ purpose: "SIGN_IN", email });
  if (!result.ok) return { error: issueError(result) };
  await setPendingCookie(result.id);
  return { notice: "We sent you a new code. Earlier codes no longer work." };
}

export async function verifySignInCode(_prev: CodeFormState, formData: FormData): Promise<CodeFormState> {
  const pendingId = await pendingSignInId();
  if (!pendingId) {
    return { error: "This sign-in has expired. Enter your email again to get a new code." };
  }

  const code = codeSchema.safeParse(formData.get("code"));
  if (!code.success) return { error: code.error.issues[0]?.message };

  const result = await checkEmailCode({ id: pendingId, code: code.data, purpose: "SIGN_IN" });
  if (!result.ok) return { error: checkError(result) };

  // The code proves the person controls this inbox: find or create the
  // account for it and mark the email as confirmed.
  const email = result.row.email;
  const now = new Date();
  await db.insert(userTable).values({ email, emailVerified: now }).onConflictDoNothing({ target: userTable.email });
  const [account] = await db.select().from(userTable).where(eq(userTable.email, email)).limit(1);
  if (!account || account.deletedAt || account.suspendedAt) {
    return { error: "This account can't sign in. Contact support if you think this is a mistake." };
  }
  if (!account.emailVerified) {
    await db.update(userTable).set({ emailVerified: now }).where(eq(userTable.id, account.id));
  }

  // Replace any session this browser already had (no session fixation, and
  // no orphaned row for a previous user).
  const previous = await getCurrentSessionTokenHash();
  if (previous) await db.delete(session).where(eq(session.tokenHash, previous));

  await startSession(account.id);
  (await cookies()).delete(pendingSignInCookieName());
  redirect(safeCallbackUrl(formData.get("callbackUrl")) as Route);
}

// ---------------------------------------------------------------------------
// Confirming the email of a signed-in user (e.g. after Google/Apple sign-up)
// ---------------------------------------------------------------------------

export async function sendVerifyEmailCode(_prev: CodeFormState): Promise<CodeFormState> {
  const user = await requireSignedInUser();
  await assertNotImpersonating();
  if (user.emailConfirmed) redirect("/dashboard");
  const result = await issueOrExplain({ purpose: "VERIFY_EMAIL", email: user.email.toLowerCase(), userId: user.id });
  if (!result.ok) return { error: issueError(result) };
  return { notice: "We sent you a new code. Earlier codes no longer work." };
}

export async function confirmEmailCode(_prev: CodeFormState, formData: FormData): Promise<CodeFormState> {
  const user = await requireSignedInUser();
  await assertNotImpersonating();
  if (user.emailConfirmed) redirect("/dashboard");

  const code = codeSchema.safeParse(formData.get("code"));
  if (!code.success) return { error: code.error.issues[0]?.message };

  // Codes are bound to the user: the lookup is by the signed-in user's id,
  // never by an id from the form.
  const pending = await activeVerifyCodeFor(user.id);
  if (!pending) return { error: "That code has expired or was tried too many times. Request a new one." };

  const result = await checkEmailCode({ id: pending.id, code: code.data, purpose: "VERIFY_EMAIL", userId: user.id });
  if (!result.ok) return { error: checkError(result) };

  await db
    .update(userTable)
    .set({ emailVerified: new Date() })
    .where(and(eq(userTable.id, user.id), isNull(userTable.emailVerified)));
  redirect(user.onboarded ? homePathFor(user.role) : "/onboarding");
}
