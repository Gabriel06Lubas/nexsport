import "server-only";

import { randomUUID } from "node:crypto";

import { cookies } from "next/headers";

import { db } from "@/db";

import { NexportAdapter } from "./adapter";
import { SESSION_IDLE_TIMEOUT_SECONDS } from "./lib/session-policy";

// Sessions started outside Auth.js (email-code sign-in) must be
// indistinguishable from the ones Auth.js creates: same table, same hashing,
// same cookie name and flags. auth.ts passes useSecureCookies() to Auth.js so
// both sides agree on the cookie name.

/** HTTPS deployments get Secure cookies with the __Secure- prefix. */
export function useSecureCookies(): boolean {
  const url = process.env.AUTH_URL?.trim();
  return url ? url.startsWith("https://") : process.env.NODE_ENV === "production";
}

export function sessionCookieName(): string {
  return `${useSecureCookies() ? "__Secure-" : ""}authjs.session-token`;
}

/** Creates a database session for `userId` and sets the session cookie. */
export async function startSession(userId: string): Promise<void> {
  const sessionToken = randomUUID(); // same generator Auth.js uses
  const { expires } = await NexportAdapter(db).createSession!({
    sessionToken,
    userId,
    expires: new Date(Date.now() + SESSION_IDLE_TIMEOUT_SECONDS * 1000),
  });
  (await cookies()).set(sessionCookieName(), sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: useSecureCookies(),
    expires,
  });
}
