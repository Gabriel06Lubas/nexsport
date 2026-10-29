import "server-only";

import { createId } from "@paralleldrive/cuid2";
import { and, count, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { cookies, headers } from "next/headers";

import { db } from "@/db";
import { emailCode } from "@/db/schema";
import { sendEmail } from "@/modules/notifications/email";

import { verificationCodeEmail } from "./emails/verification-code";
import { authSecret } from "./secret";
import { useSecureCookies } from "./session-cookie";
import {
  CODE_TTL_SECONDS,
  generateCode,
  hashCode,
  hashesMatch,
  hashIp,
  MAX_ATTEMPTS,
  MAX_CODES_PER_EMAIL_PER_HOUR,
  MAX_CODES_PER_IP_PER_HOUR,
  RESEND_COOLDOWN_SECONDS,
} from "./lib/email-code-policy";

// Issuing and checking one-time email codes. Callers pass already-validated
// input (emailSchema / codeSchema); every query here is parameterised.

type Purpose = "SIGN_IN" | "VERIFY_EMAIL";
type EmailCodeRow = typeof emailCode.$inferSelect;

const secret = authSecret;

/**
 * Client IP for rate limiting. Takes the first X-Forwarded-For entry, which
 * is only trustworthy behind a proxy that overwrites the header (Vercel,
 * most load balancers). Without one it can be spoofed, so the per-address
 * limits, not this one, are the real protection.
 */
async function clientIpHash(): Promise<string | null> {
  try {
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim();
    return ip ? hashIp(secret(), ip.slice(0, 64)) : null;
  } catch {
    return null;
  }
}

export type IssueResult =
  | { ok: true; id: string }
  | { ok: false; reason: "cooldown"; retryAfterSeconds: number }
  | { ok: false; reason: "rate_limited" | "send_failed" };

/**
 * Creates a code for `email`, invalidates earlier unused codes for the same
 * address and purpose, and emails it. Rate limits are checked under a
 * per-address advisory lock, so concurrent requests can't both slip through.
 */
export async function issueEmailCode(input: { purpose: Purpose; email: string; userId?: string }): Promise<IssueResult> {
  const ipHash = await clientIpHash();
  const now = new Date();
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const id = createId();
  const code = generateCode();

  const issued = await db.transaction(async (tx): Promise<IssueResult> => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`email-code:${input.email}`}))`);

    const [latest] = await tx
      .select({ createdAt: emailCode.createdAt })
      .from(emailCode)
      .where(eq(emailCode.email, input.email))
      .orderBy(desc(emailCode.createdAt))
      .limit(1);
    if (latest) {
      const elapsed = (now.getTime() - latest.createdAt.getTime()) / 1000;
      if (elapsed < RESEND_COOLDOWN_SECONDS) {
        return { ok: false, reason: "cooldown", retryAfterSeconds: Math.ceil(RESEND_COOLDOWN_SECONDS - elapsed) };
      }
    }

    const [{ perEmail = 0 } = {}] = await tx
      .select({ perEmail: count() })
      .from(emailCode)
      .where(and(eq(emailCode.email, input.email), gt(emailCode.createdAt, hourAgo)));
    if (perEmail >= MAX_CODES_PER_EMAIL_PER_HOUR) return { ok: false, reason: "rate_limited" };

    if (ipHash) {
      const [{ perIp = 0 } = {}] = await tx
        .select({ perIp: count() })
        .from(emailCode)
        .where(and(eq(emailCode.ipHash, ipHash), gt(emailCode.createdAt, hourAgo)));
      if (perIp >= MAX_CODES_PER_IP_PER_HOUR) return { ok: false, reason: "rate_limited" };
    }

    // Only the newest code for an address works.
    await tx
      .update(emailCode)
      .set({ expiresAt: now })
      .where(
        and(
          eq(emailCode.email, input.email),
          eq(emailCode.purpose, input.purpose),
          isNull(emailCode.consumedAt),
          gt(emailCode.expiresAt, now),
        ),
      );
    // Housekeeping: the send log only needs to cover the rate-limit window.
    await tx.delete(emailCode).where(lt(emailCode.createdAt, new Date(now.getTime() - 24 * 60 * 60 * 1000)));

    await tx.insert(emailCode).values({
      id,
      purpose: input.purpose,
      email: input.email,
      userId: input.userId ?? null,
      codeHash: hashCode(secret(), id, code),
      expiresAt: new Date(now.getTime() + CODE_TTL_SECONDS * 1000),
      ipHash,
      createdAt: now,
    });
    return { ok: true, id };
  });

  if (!issued.ok) return issued;
  try {
    await sendEmail(verificationCodeEmail(input.email, code, input.purpose));
  } catch (error) {
    console.error("[email-code] sending failed:", error instanceof Error ? error.message : error);
    await db.update(emailCode).set({ expiresAt: new Date() }).where(eq(emailCode.id, id));
    return { ok: false, reason: "send_failed" };
  }
  return issued;
}

export type CheckResult =
  | { ok: true; row: EmailCodeRow }
  | { ok: false; reason: "invalid"; attemptsLeft: number }
  | { ok: false; reason: "expired" };

/**
 * Checks `code` against code row `id`. The attempt counter is incremented
 * atomically *before* comparing, so parallel guesses can't exceed
 * MAX_ATTEMPTS, and consuming the code is a conditional update, so a code
 * works exactly once even if submitted twice at the same moment.
 */
export async function checkEmailCode(input: {
  id: string;
  code: string;
  purpose: Purpose;
  userId?: string;
}): Promise<CheckResult> {
  const now = new Date();
  const [row] = await db
    .update(emailCode)
    .set({ attempts: sql`${emailCode.attempts} + 1` })
    .where(
      and(
        eq(emailCode.id, input.id),
        eq(emailCode.purpose, input.purpose),
        input.userId ? eq(emailCode.userId, input.userId) : isNull(emailCode.userId),
        isNull(emailCode.consumedAt),
        gt(emailCode.expiresAt, now),
        lt(emailCode.attempts, MAX_ATTEMPTS),
      ),
    )
    .returning();
  // Unknown id, someone else's code, already used, expired, or out of attempts.
  if (!row) return { ok: false, reason: "expired" };

  if (!hashesMatch(row.codeHash, hashCode(secret(), row.id, input.code))) {
    const attemptsLeft = MAX_ATTEMPTS - row.attempts;
    return attemptsLeft > 0 ? { ok: false, reason: "invalid", attemptsLeft } : { ok: false, reason: "expired" };
  }

  const [consumed] = await db
    .update(emailCode)
    .set({ consumedAt: now })
    .where(and(eq(emailCode.id, row.id), isNull(emailCode.consumedAt)))
    .returning();
  return consumed ? { ok: true, row: consumed } : { ok: false, reason: "expired" };
}

/** The newest still-usable VERIFY_EMAIL code for a user, if any. */
export async function activeVerifyCodeFor(userId: string) {
  const [row] = await db
    .select({ id: emailCode.id, email: emailCode.email, createdAt: emailCode.createdAt })
    .from(emailCode)
    .where(
      and(
        eq(emailCode.userId, userId),
        eq(emailCode.purpose, "VERIFY_EMAIL"),
        isNull(emailCode.consumedAt),
        gt(emailCode.expiresAt, new Date()),
        lt(emailCode.attempts, MAX_ATTEMPTS),
      ),
    )
    .orderBy(desc(emailCode.createdAt))
    .limit(1);
  return row ?? null;
}

// ---------------------------------------------------------------------------
// The pending "Continue with email" sign-in. Its code id travels in an
// httpOnly cookie, never in the URL, so a code only works in the browser that
// asked for it. `__Host-` (HTTPS only) pins the cookie to this exact host.
// ---------------------------------------------------------------------------

export function pendingSignInCookieName(): string {
  return useSecureCookies() ? "__Host-nexport.email-sign-in" : "nexport.email-sign-in";
}

/** The code id from the pending-sign-in cookie, if it looks like one of ours. */
export async function pendingSignInId(): Promise<string | null> {
  const value = (await cookies()).get(pendingSignInCookieName())?.value;
  return value && /^[a-z0-9]{1,64}$/.test(value) ? value : null;
}

/** Email address of this browser's pending sign-in code, if it's still open. */
export async function pendingSignInEmail(): Promise<string | null> {
  const id = await pendingSignInId();
  if (!id) return null;
  const [row] = await db
    .select({ email: emailCode.email })
    .from(emailCode)
    .where(and(eq(emailCode.id, id), eq(emailCode.purpose, "SIGN_IN"), isNull(emailCode.consumedAt)))
    .limit(1);
  return row?.email ?? null;
}
