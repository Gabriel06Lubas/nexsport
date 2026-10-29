import "server-only";

import { importPKCS8, SignJWT } from "jose";
import type { Provider } from "next-auth/providers";
import Apple from "next-auth/providers/apple";
import Google from "next-auth/providers/google";

// Sign-in providers. Each one is enabled only when its credentials are set,
// so a fresh checkout (or the marketing build) runs without any of them.

export type ProviderId = "google" | "apple";

export const providerLabels: Record<ProviderId, string> = {
  google: "Google",
  apple: "Apple",
};

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

/**
 * Lets the e2e suite point a provider at a local mock OpenID server.
 * Ignored in production builds, so it can never redirect real logins.
 */
function testIssuer(name: string): { issuer: string } | Record<string, never> {
  const issuer = process.env.NODE_ENV !== "production" ? env(name) : undefined;
  return issuer ? { issuer } : {};
}

export function isGoogleConfigured() {
  return Boolean(env("AUTH_GOOGLE_ID") && env("AUTH_GOOGLE_SECRET"));
}

export function isAppleConfigured() {
  return Boolean(env("AUTH_APPLE_ID") && env("AUTH_APPLE_TEAM_ID") && env("AUTH_APPLE_KEY_ID") && env("AUTH_APPLE_PRIVATE_KEY"));
}

export function configuredProviderIds(): ProviderId[] {
  return [...(isGoogleConfigured() ? (["google"] as const) : []), ...(isAppleConfigured() ? (["apple"] as const) : [])];
}

// ---------------------------------------------------------------------------
// Apple's "client secret" is not a static string: it is an ES256 JWT signed
// with the .p8 key from the Apple developer portal (max validity 6 months).
// Instead of pasting a long-lived token into the environment and rotating it
// by hand, we mint a short-lived one from the key and refresh it in memory.
// ---------------------------------------------------------------------------
const APPLE_SECRET_TTL_SECONDS = 24 * 60 * 60;
let appleSecret: { value: string; expiresAt: number } | undefined;

async function appleClientSecret(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (appleSecret && appleSecret.expiresAt - now > 60 * 60) return appleSecret.value;

  // Env vars can't hold real newlines everywhere; accept "\n"-escaped keys.
  const pem = env("AUTH_APPLE_PRIVATE_KEY")!.replace(/\\n/g, "\n");
  const key = await importPKCS8(pem, "ES256");
  const value = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: env("AUTH_APPLE_KEY_ID")! })
    .setIssuer(env("AUTH_APPLE_TEAM_ID")!)
    .setSubject(env("AUTH_APPLE_ID")!)
    .setAudience("https://appleid.apple.com")
    .setIssuedAt(now)
    .setExpirationTime(now + APPLE_SECRET_TTL_SECONDS)
    .sign(key);
  appleSecret = { value, expiresAt: now + APPLE_SECRET_TTL_SECONDS };
  return value;
}

export async function buildProviders(): Promise<Provider[]> {
  const providers: Provider[] = [];

  if (isGoogleConfigured()) {
    providers.push(
      Google({
        clientId: env("AUTH_GOOGLE_ID"),
        clientSecret: env("AUTH_GOOGLE_SECRET"),
        // Safe because the signIn callback only admits verified emails, and
        // linking is what lets someone use Google and Apple for one account.
        allowDangerousEmailAccountLinking: true,
        ...testIssuer("AUTH_GOOGLE_ISSUER"),
      }),
    );
  }

  if (isAppleConfigured()) {
    providers.push(
      Apple({
        clientId: env("AUTH_APPLE_ID"),
        clientSecret: await appleClientSecret(),
        allowDangerousEmailAccountLinking: true,
        ...testIssuer("AUTH_APPLE_ISSUER"),
      }),
    );
  }

  return providers;
}
