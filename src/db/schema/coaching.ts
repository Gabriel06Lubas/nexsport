import { sql } from "drizzle-orm";
import { boolean, char, check, integer, pgTable, smallint, text } from "drizzle-orm/pg-core";

import { createdAt, fk, id, idx, tstz, uniq, updatedAt } from "../columns";
import { user } from "./auth";
import { club, facility, sport } from "./clubs";
import { memberPass } from "./memberships";
import { practiceSession } from "./scheduling";

// =============================================================================
// COACHING: public booking profile, weekly availability, credit adjustments
// =============================================================================

/**
 * A coach's public booking page (/coach/<slug>) and default terms. Students
 * self-book private sessions inside the coach's availability windows.
 */
export const coachProfile = pgTable(
  "CoachProfile",
  {
    userId: text().primaryKey(),
    slug: text().notNull(),
    headline: text(),
    bio: text(),
    bookingEnabled: boolean().notNull().default(false),
    /** IANA zone for the coach's own schedule and KPIs. */
    timezone: text().notNull().default("UTC"),
    /** Sport used for self-booked private sessions. */
    sportId: text(),
    /** Per hour, minor units: one-to-one sessions. */
    privateRateAmount: integer(),
    /** Per person per hour, minor units: group sessions. */
    groupRateAmount: integer(),
    currency: char({ length: 3 }).notNull().default("eur"),
    /** Length of a self-booked session. */
    sessionMinutes: integer().notNull().default(60),
    /** Earliest a slot can be booked, before it starts. */
    minNoticeHours: integer().notNull().default(12),
    /** How far ahead slots are offered. */
    maxAdvanceDays: integer().notNull().default(21),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniq("CoachProfile", t.slug),
    fk("CoachProfile", [t.userId], [user.id]).onDelete("cascade"),
    fk("CoachProfile", [t.sportId], [sport.id]).onDelete("set null"),
    check("CoachProfile_slug_format", sql`"slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length("slug") BETWEEN 3 AND 48`),
    check("CoachProfile_rates_non_negative", sql`("privateRateAmount" IS NULL OR "privateRateAmount" >= 0) AND ("groupRateAmount" IS NULL OR "groupRateAmount" >= 0)`),
    check("CoachProfile_currency_format", sql`"currency" ~ '^[a-z]{3}$'`),
    check("CoachProfile_session_minutes", sql`"sessionMinutes" BETWEEN 30 AND 180 AND "sessionMinutes" % 15 = 0`),
    check("CoachProfile_notice", sql`"minNoticeHours" BETWEEN 0 AND 168 AND "maxAdvanceDays" BETWEEN 1 AND 90`),
    // Booking can only be switched on once there's a price and a sport.
    check("CoachProfile_bookable", sql`NOT "bookingEnabled" OR ("privateRateAmount" IS NOT NULL AND "sportId" IS NOT NULL)`),
  ],
);

/**
 * A recurring weekly window when the coach takes private bookings at a club
 * (club time zone), optionally on a preferred facility. Windows of one coach
 * on one weekday can't overlap ("CoachAvailability_no_overlap", migration 0008).
 */
export const coachAvailability = pgTable(
  "CoachAvailability",
  {
    id: id(),
    coachId: text().notNull(),
    clubId: text().notNull(),
    facilityId: text(),
    /** ISO weekday: 1 = Monday … 7 = Sunday. */
    dayOfWeek: smallint().notNull(),
    startMinute: integer().notNull(),
    endMinute: integer().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    idx("CoachAvailability", t.coachId, t.dayOfWeek),
    idx("CoachAvailability", t.clubId),
    fk("CoachAvailability", [t.coachId], [user.id]).onDelete("cascade"),
    fk("CoachAvailability", [t.clubId], [club.id]).onDelete("cascade"),
    // The preferred facility must belong to the window's club.
    fk("CoachAvailability", [t.facilityId, t.clubId], [facility.id, facility.clubId]).onDelete("cascade"),
    check("CoachAvailability_day_of_week", sql`"dayOfWeek" BETWEEN 1 AND 7`),
    check(
      "CoachAvailability_window",
      sql`"startMinute" >= 0 AND "startMinute" < "endMinute" AND "endMinute" <= 1440 AND "startMinute" % 15 = 0 AND "endMinute" % 15 = 0`,
    ),
  ],
);

/**
 * Every manual change to a pass's credits (club desk or coach), with who did
 * it and why, so a club can always see where its credits went.
 */
export const passCreditAdjustment = pgTable(
  "PassCreditAdjustment",
  {
    id: id(),
    clubId: text().notNull(),
    passId: text().notNull(),
    /** Credits used: +1 deducts a session, -1 gives one back. */
    delta: smallint().notNull(),
    reason: text().notNull(),
    actorId: text(),
    sessionId: text(),
    createdAt: createdAt(),
  },
  (t) => [
    idx("PassCreditAdjustment", t.passId, t.createdAt),
    idx("PassCreditAdjustment", t.actorId, t.createdAt),
    fk("PassCreditAdjustment", [t.clubId], [club.id]).onDelete("cascade"),
    fk("PassCreditAdjustment", [t.passId, t.clubId], [memberPass.id, memberPass.clubId]).onDelete("cascade"),
    fk("PassCreditAdjustment", [t.actorId], [user.id]).onDelete("set null"),
    fk("PassCreditAdjustment", [t.sessionId], [practiceSession.id]).onDelete("set null"),
    check("PassCreditAdjustment_delta", sql`"delta" IN (-1, 1)`),
  ],
);
