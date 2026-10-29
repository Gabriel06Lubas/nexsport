import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

import { z } from "zod";

// Rules for one-time email codes. Pure functions only (unit-tested); the
// database and email side lives in ../email-code.ts.
//
// Guessing odds: a 6-digit code allows 5 attempts and an address gets at most
// 5 codes an hour, so an attacker gets ≤ 25 guesses per hour against 10^6
// possibilities: a 0.0025% chance per hour, before the per-IP limit.

export const CODE_LENGTH = 6;
export const CODE_TTL_SECONDS = 10 * 60;
export const MAX_ATTEMPTS = 5;
export const RESEND_COOLDOWN_SECONDS = 60;
export const MAX_CODES_PER_EMAIL_PER_HOUR = 5;
export const MAX_CODES_PER_IP_PER_HOUR = 20;

/** Uniformly random 6-digit code from the OS CSPRNG, e.g. "042913". */
export function generateCode(): string {
  return randomInt(0, 10 ** CODE_LENGTH)
    .toString()
    .padStart(CODE_LENGTH, "0");
}

/**
 * Keyed hash of a code. Binding it to the row id means identical codes in two
 * rows hash differently; keying it with the server secret means a stolen
 * database can't be brute-forced offline (10^6 plain hashes would be trivial).
 */
export function hashCode(secret: string, codeId: string, code: string): string {
  return createHmac("sha256", secret).update(`email-code:${codeId}:${code}`).digest("hex");
}

/** Constant-time comparison of two hex digests. */
export function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

/** Keyed hash of the client IP, for rate limiting without storing the IP. */
export function hashIp(secret: string, ip: string): string {
  return createHmac("sha256", secret).update(`ip:${ip}`).digest("hex");
}

// ---------------------------------------------------------------------------
// Input parsing. Everything typed into a text box goes through these schemas
// before it reaches the database or an email header. (Queries are also
// parameterised by Drizzle, so input is never spliced into SQL text.)
// ---------------------------------------------------------------------------

// Rejects CR/LF and other control characters outright: they are how email
// header injection works ("victim@x.com\r\nBcc: ...").
const noControlChars = (value: string) => !/[\u0000-\u001f\u007f]/.test(value);

export const emailSchema = z
  .string({ error: "Enter your email address" })
  .max(320, "That email address is too long")
  .refine(noControlChars, "Enter a valid email address")
  .transform((value) => value.trim().toLowerCase())
  .pipe(z.email({ error: "Enter a valid email address" }).max(254, "That email address is too long"));

/** Accepts "123456", "123 456" or "123-456"; anything else is rejected. */
export const codeSchema = z
  .string({ error: "Enter the 6-digit code" })
  .max(20, "Enter the 6-digit code")
  .transform((value) => value.replace(/[\s-]/g, ""))
  .pipe(z.string().regex(/^\d{6}$/, "Enter the 6-digit code"));

/** "maria@example.com" → "m••••@example.com", for showing where a code went. */
export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  const shown = local.slice(0, 1);
  return `${shown}${"•".repeat(Math.max(local.length - 1, 1))}@${domain}`;
}
