import { sql } from "drizzle-orm";
import { boolean, check, date, integer, pgTable, primaryKey, text, varchar } from "drizzle-orm/pg-core";
import type { PgTableExtraConfigValue } from "drizzle-orm/pg-core";

import { createdAt, fk, id, idx, tstz, uniq, updatedAt } from "../columns";
import { club, sport } from "./clubs";
import { followStatus, userRole } from "./enums";

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
  },
  (t) => [
    uniq("Session", t.tokenHash),
    idx("Session", t.userId),
    idx("Session", t.expires),
    fk("Session", [t.userId], [user.id]).onDelete("cascade"),
    // Tokens are stored as lowercase hex SHA-256 digests, never raw.
    check("Session_tokenHash_sha256", sql`"tokenHash" ~ '^[0-9a-f]{64}$'`),
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
