import "server-only";

import NextAuth, { type NextAuthConfig } from "next-auth";

import { db } from "@/db";

import { NexportAdapter } from "./adapter";
import { SESSION_IDLE_TIMEOUT_SECONDS, SESSION_UPDATE_AGE_SECONDS } from "./lib/session-policy";
import { buildProviders, isAppleConfigured } from "./providers";

// Apple returns users with a cross-site POST (response_mode=form_post), and
// browsers don't send SameSite=Lax cookies on cross-site POSTs. Auth.js
// already relaxes its state/nonce cookies for form_post providers, but not
// the callback-url cookie, so after an Apple login the user would land on
// "/" instead of the page they asked for (e2e/auth.e2e.mjs covers this).
// Only that cookie is relaxed to SameSite=None. It holds nothing but the
// post-login path, which Auth.js only ever redirects to on our own origin.
// The session cookie itself stays Lax.
const appleCallbackUrlCookie = {
  name: "__Secure-authjs.callback-url",
  options: { httpOnly: true, sameSite: "none" as const, path: "/", secure: true },
};

/** Google sends a boolean; Apple has historically sent the string "true". */
function isEmailVerified(value: unknown): boolean {
  return value === true || value === "true";
}

export const { handlers, auth, signIn, signOut } = NextAuth(async (): Promise<NextAuthConfig> => {
  const providers = await buildProviders();

  return {
    adapter: NexportAdapter(db),
    providers,
    // Server-side sessions: the cookie holds an opaque random token and every
    // request is checked against the Session table. Unlike a JWT, a session
    // can be revoked instantly (sign-out, "sign out everywhere", account
    // suspension) and role changes apply on the very next request.
    session: {
      strategy: "database",
      maxAge: SESSION_IDLE_TIMEOUT_SECONDS,
      updateAge: SESSION_UPDATE_AGE_SECONDS,
    },
    pages: { signIn: "/login", error: "/login" },
    ...(isAppleConfigured() && { cookies: { callbackUrl: appleCallbackUrlCookie } }),
    callbacks: {
      signIn({ account, profile }) {
        // Only our OpenID Connect providers, and only identities whose email
        // the provider has verified. This is what makes linking Google and
        // Apple accounts by email safe.
        if (account?.type !== "oidc") return false;
        return isEmailVerified(profile?.email_verified);
      },
      session({ session, user }) {
        // Exposed to the app. Read fresh from the database on every request,
        // so it is never stale. Keep it minimal: no tokens, no internals.
        return {
          expires: session.expires,
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            image: user.image,
            role: user.role ?? "STUDENT",
            activeClubId: user.activeClubId ?? null,
            onboarded: Boolean(user.onboardedAt),
          },
        };
      },
    },
  };
});
