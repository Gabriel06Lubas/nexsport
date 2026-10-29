import { createHash } from "node:crypto";

// Session lifetime rules. Two independent limits:
//   * idle timeout: the session expires after IDLE_TIMEOUT of inactivity.
//     Activity pushes `expires` forward, at most once per UPDATE_AGE so an
//     active user costs one DB write per day, not one per request.
//   * absolute lifetime: no session outlives ABSOLUTE_LIFETIME from sign-in,
//     however active it is. A stolen cookie therefore has a hard end date.
const DAY = 24 * 60 * 60;

export const SESSION_IDLE_TIMEOUT_SECONDS = 14 * DAY;
export const SESSION_UPDATE_AGE_SECONDS = 1 * DAY;
export const SESSION_ABSOLUTE_LIFETIME_SECONDS = 60 * DAY;

/**
 * Session tokens are 122-bit random UUIDs, so an unsalted SHA-256 is enough:
 * the hash is not reversible and there is no low-entropy input to brute-force.
 */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function absoluteDeadline(createdAt: Date): Date {
  return new Date(createdAt.getTime() + SESSION_ABSOLUTE_LIFETIME_SECONDS * 1000);
}

export function isPastAbsoluteLifetime(createdAt: Date, now = new Date()): boolean {
  return now >= absoluteDeadline(createdAt);
}

/** Never let a sliding refresh push a session past its absolute deadline. */
export function capExpiry(requested: Date, createdAt: Date): Date {
  const deadline = absoluteDeadline(createdAt);
  return requested < deadline ? requested : deadline;
}
