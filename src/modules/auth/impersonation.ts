import "server-only";

import { randomUUID } from "node:crypto";

import { and, eq, gt } from "drizzle-orm";
import { cookies, headers } from "next/headers";

import { db } from "@/db";
import { session, user } from "@/db/schema";

import { hashSessionToken } from "./lib/session-policy";
import { sessionCookieName, useSecureCookies } from "./session-cookie";

// Admin impersonation ("view as this user").
//
// Starting creates a *separate* session for the target user, marked with
// impersonatorId, with a hard 1-hour expiry that never slides. The admin's
// own session token is parked in an httpOnly cookie so "Stop impersonating"
// can hand the admin their session back. The adapter kills impersonation
// sessions as soon as the admin is suspended, deleted or demoted.

export const IMPERSONATION_TTL_SECONDS = 60 * 60;

const returnCookieName = () => (useSecureCookies() ? "__Host-nexport.admin-return" : "nexport.admin-return");

export type StartResult = { ok: true } | { ok: false; reason: string };

export async function startImpersonation(adminId: string, targetUserId: string): Promise<StartResult> {
  const [target] = await db.select().from(user).where(eq(user.id, targetUserId)).limit(1);
  if (!target || target.deletedAt) return { ok: false, reason: "That user no longer exists." };
  if (target.role === "ADMIN") return { ok: false, reason: "Admins can't be impersonated." };
  if (target.suspendedAt) return { ok: false, reason: "This account is suspended. Reactivate it first." };
  if (target.id === adminId) return { ok: false, reason: "You can't impersonate yourself." };

  const jar = await cookies();
  const adminToken = jar.get(sessionCookieName())?.value;
  if (!adminToken) return { ok: false, reason: "Your session has expired. Sign in again." };

  const token = randomUUID();
  const expires = new Date(Date.now() + IMPERSONATION_TTL_SECONDS * 1000);
  const userAgent = (await headers()).get("user-agent")?.slice(0, 512) ?? null;
  await db.insert(session).values({
    tokenHash: hashSessionToken(token),
    userId: target.id,
    expires,
    userAgent,
    impersonatorId: adminId,
  });

  const options = { httpOnly: true, sameSite: "lax" as const, path: "/", secure: useSecureCookies(), expires };
  jar.set(returnCookieName(), adminToken, options);
  jar.set(sessionCookieName(), token, options);
  return { ok: true };
}

/**
 * Ends the impersonation session in this browser and restores the admin's
 * own session if it is still valid. Returns whether the admin is signed in
 * again (false: they have to sign in).
 */
export async function stopImpersonation(): Promise<boolean> {
  const jar = await cookies();
  const current = jar.get(sessionCookieName())?.value;
  const parked = jar.get(returnCookieName())?.value;
  jar.delete(returnCookieName());

  let impersonatorId: string | null = null;
  if (current) {
    const [ended] = await db
      .delete(session)
      .where(eq(session.tokenHash, hashSessionToken(current)))
      .returning({ impersonatorId: session.impersonatorId });
    impersonatorId = ended?.impersonatorId ?? null;
  }

  if (parked && impersonatorId) {
    // Only restore a token that is a live session of the same admin.
    const [own] = await db
      .select({ expires: session.expires })
      .from(session)
      .where(
        and(eq(session.tokenHash, hashSessionToken(parked)), eq(session.userId, impersonatorId), gt(session.expires, new Date())),
      )
      .limit(1);
    if (own) {
      jar.set(sessionCookieName(), parked, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: useSecureCookies(),
        expires: own.expires,
      });
      return true;
    }
  }
  jar.delete(sessionCookieName());
  return false;
}
