import { sql } from "drizzle-orm";
import { boolean, check, date, integer, pgTable, primaryKey, text, varchar } from "drizzle-orm/pg-core";
import type { PgTableExtraConfigValue } from "drizzle-orm/pg-core";

import { createdAt, fk, id, idx, tstz, uniq, updatedAt } from "../columns";
import { club, sport } from "./clubs";
import { emailCodePurpose, followStatus, userRole } from "./enums";

// =============================================================================
// AUTH & IDENTITY
// =============================================================================

export const user = pgTable(
  "User",
  {
    id: id(),
    name: text(),
    email: text().notNull(),
    emailVerified: tstz(),
    image: text(),
    /** Sign-in is OAuth-only (Google, Apple), so no password is ever stored. */
    role: userRole().notNull().default("STUDENT"),
    /** Set when the user finishes onboarding (role + profile handle). */
    onboardedAt: tstz(),
    /** Club the user last worked in; exposed on the session as `activeClubId`. */
    activeClubId: text(),
    /** Stripe Customer used when this user pays for sessions / coach SaaS plan. */
    stripeCustomerId: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: tstz(),
    /** Set by an admin: sessions are revoked and sign-in is refused. */
    suspendedAt: tstz(),
    suspensionReason: varchar({ length: 500 }),
  },
  // Annotated: User and Club reference each other, which would otherwise
  // make TypeScript give up inferring either table's type.
  (t): PgTableExtraConfigValue[] => [
    uniq("User", t.email),
    uniq("User", t.stripeCustomerId),
    idx("User", t.role),
    fk("User", [t.activeClubId], [club.id]).onDelete("set null"),
  ],
);

/**
 * A linked OAuth identity (Google, Apple). Provider access/refresh tokens are
 * deliberately NOT stored: nexport only needs the identity, and tokens that
 * are never persisted can't leak.
 */
export const account = pgTable(
  "Account",
  {
    id: id(),
    userId: text().notNull(),
    type: text().notNull(),
    provider: text().notNull(),
    providerAccountId: text().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniq("Account", t.provider, t.providerAccountId),
    idx("Account", t.userId),
    fk("Account", [t.userId], [user.id]).onDelete("cascade"),
  ],
);

/**
 * Server-side login session (Auth.js "database" strategy). The browser only
 * holds a random token in an httpOnly cookie; this table stores its SHA-256
 * hash, so a database leak does not hand out live sessions.
 * See src/modules/auth/adapter.ts and docs/step-2-auth.md.
 */
export const session = pgTable(
  "Session",
  {
    id: id(),
    tokenHash: text().notNull(),
    userId: text().notNull(),
    /** Idle expiry; pushed forward (at most daily) while the user is active. */
    expires: tstz().notNull(),
    /** Shown in "Your devices" so users can spot and revoke unknown sessions. */
    userAgent: varchar({ length: 512 }),
    createdAt: createdAt(),
    /** Approximate last activity (updated with `expires`). */
    lastSeenAt: tstz().notNull().defaultNow(),
    /**
     * Set when an admin is impersonating `userId`. Such sessions have a hard
     * 1-hour lifetime, never slide, and die if the admin loses the role.
     */
    impersonatorId: text(),
  },
  (t) => [
    uniq("Session", t.tokenHash),
    idx("Session", t.userId),
    idx("Session", t.expires),
    fk("Session", [t.userId], [user.id]).onDelete("cascade"),
    fk("Session", [t.impersonatorId], [user.id]).onDelete("cascade"),
    // Tokens are stored as lowercase hex SHA-256 digests, never raw.
    check("Session_tokenHash_sha256", sql`"tokenHash" ~ '^[0-9a-f]{64}$'`),
  ],
);

/**
 * One-time 6-digit email codes (see src/modules/auth/email-code.ts).
 * Only an HMAC of the code is stored, keyed with AUTH_SECRET, so a database
 * leak neither reveals codes nor allows guessing them offline. Each code is
 * single-use, expires after 10 minutes and allows 5 attempts. Rows also serve
 * as the send log for rate limiting (per email and per hashed client IP).
 */
export const emailCode = pgTable(
  "EmailCode",
  {
    id: id(),
    purpose: emailCodePurpose().notNull(),
    /** Lower-cased recipient address. */
    email: text().notNull(),
    /** Set for VERIFY_EMAIL (the signed-in user); null for SIGN_IN. */
    userId: text(),
    codeHash: text().notNull(),
    attempts: integer().notNull().default(0),
    expiresAt: tstz().notNull(),
    consumedAt: tstz(),
    /** HMAC of the requesting IP: enough to rate-limit, without storing the IP. */
    ipHash: text(),
    createdAt: createdAt(),
  },
  (t) => [
    idx("EmailCode", t.email, t.createdAt),
    idx("EmailCode", t.ipHash, t.createdAt),
    idx("EmailCode", t.userId),
    fk("EmailCode", [t.userId], [user.id]).onDelete("cascade"),
    check("EmailCode_codeHash_hex", sql`"codeHash" ~ '^[0-9a-f]{64}$'`),
    check("EmailCode_attempts_range", sql`"attempts" BETWEEN 0 AND 5`),
    check("EmailCode_email_length", sql`char_length("email") BETWEEN 3 AND 254`),
    check("EmailCode_verify_has_user", sql`"purpose" <> 'VERIFY_EMAIL' OR "userId" IS NOT NULL`),
  ],
);

export const profile = pgTable(
  "Profile",
  {
    id: id(),
    userId: text().notNull(),
    /** Lower-cased @handle, unique platform-wide. */
    handle: text().notNull(),
    displayName: text().notNull(),
    bio: varchar({ length: 500 }),
    avatarUrl: text(),
    coverUrl: text(),
    location: text(),
    websiteUrl: text(),
    dateOfBirth: date({ mode: "date" }),
    /** Private profiles require follow approval (FollowStatus.PENDING). */
    isPrivate: boolean().notNull().default(false),
    /** Denormalised counters, maintained transactionally by the social service. */
    followerCount: integer().notNull().default(0),
    followingCount: integer().notNull().default(0),
    postCount: integer().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniq("Profile", t.userId),
    uniq("Profile", t.handle),
    fk("Profile", [t.userId], [user.id]).onDelete("cascade"),
    check("Profile_handle_format", sql`"handle" ~ '^[a-z0-9_.]{3,30}$'`),
    check("Profile_counters_non_negative", sql`"followerCount" >= 0 AND "followingCount" >= 0 AND "postCount" >= 0`),
  ],
);

export const profileSport = pgTable(
  "ProfileSport",
  {
    profileId: text().notNull(),
    sportId: text().notNull(),
    /** Free-form level, e.g. "Beginner", "NTRP 4.0", "Playtomic 3.5". */
    level: text(),
  },
  (t) => [
    primaryKey({ name: "ProfileSport_pkey", columns: [t.profileId, t.sportId] }),
    idx("ProfileSport", t.sportId),
    fk("ProfileSport", [t.profileId], [profile.id]).onDelete("cascade"),
    fk("ProfileSport", [t.sportId], [sport.id]).onDelete("cascade"),
  ],
);

export const follow = pgTable(
  "Follow",
  {
    followerId: text().notNull(),
    followingId: text().notNull(),
    status: followStatus().notNull().default("ACCEPTED"),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: "Follow_pkey", columns: [t.followerId, t.followingId] }),
    idx("Follow", t.followingId, t.status),
    fk("Follow", [t.followerId], [user.id]).onDelete("cascade"),
    fk("Follow", [t.followingId], [user.id]).onDelete("cascade"),
    check("Follow_no_self_follow", sql`"followerId" <> "followingId"`),
  ],
);
