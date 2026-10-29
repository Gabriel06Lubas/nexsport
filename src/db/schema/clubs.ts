import { sql } from "drizzle-orm";
import { boolean, char, check, date, integer, pgTable, primaryKey, text, unique } from "drizzle-orm/pg-core";
import type { PgTableExtraConfigValue } from "drizzle-orm/pg-core";

import { createdAt, fk, id, idx, tstz, uniq, updatedAt } from "../columns";
import { user } from "./auth";
import {
  clubMemberStatus,
  clubPermission,
  clubRole,
  clubStatus,
  equipmentCondition,
  facilityType,
  surfaceType,
} from "./enums";

// =============================================================================
// ORGANISATION & ASSETS
// =============================================================================

export const club = pgTable(
  "Club",
  {
    id: id(),
    slug: text().notNull(),
    name: text().notNull(),
    description: text(),
    logoUrl: text(),
    coverUrl: text(),
    email: text(),
    phone: text(),
    websiteUrl: text(),
    addressLine1: text(),
    addressLine2: text(),
    city: text(),
    region: text(),
    postalCode: text(),
    /** ISO-3166-1 alpha-2 */
    country: char({ length: 2 }).notNull(),
    /** IANA tz, e.g. "Europe/Madrid". All scheduling UI renders in this zone. */
    timezone: text().notNull().default("UTC"),
    /** ISO-4217, default currency for sessions and payouts. */
    currency: char({ length: 3 }).notNull().default("eur"),
    status: clubStatus().notNull().default("PENDING_SETUP"),
    ownerId: text().notNull(),
    /** Stripe Customer billed for the club's SaaS subscription. */
    stripeCustomerId: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: tstz(),
  },
  // Annotated: User and Club reference each other, which would otherwise
  // make TypeScript give up inferring either table's type.
  (t): PgTableExtraConfigValue[] => [
    uniq("Club", t.slug),
    uniq("Club", t.stripeCustomerId),
    idx("Club", t.ownerId),
    idx("Club", t.status),
    fk("Club", [t.ownerId], [user.id]).onDelete("restrict"),
    check("Club_slug_format", sql`"slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check("Club_currency_format", sql`"currency" ~ '^[a-z]{3}$'`),
  ],
);

/** Global sport catalogue (managed by ADMIN). Clubs opt in via ClubSport. */
export const sport = pgTable(
  "Sport",
  {
    id: id(),
    /** "football", "padel", "tennis", "fitness" */
    slug: text().notNull(),
    name: text().notNull(),
    iconUrl: text(),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniq("Sport", t.slug)],
);

export const clubSport = pgTable(
  "ClubSport",
  {
    clubId: text().notNull(),
    sportId: text().notNull(),
  },
  (t) => [
    primaryKey({ name: "ClubSport_pkey", columns: [t.clubId, t.sportId] }),
    idx("ClubSport", t.sportId),
    fk("ClubSport", [t.clubId], [club.id]).onDelete("cascade"),
    fk("ClubSport", [t.sportId], [sport.id]).onDelete("restrict"),
  ],
);

export const ageGroup = pgTable(
  "AgeGroup",
  {
    id: id(),
    clubId: text().notNull(),
    /** Optional: age group specific to one sport (e.g. "U12 Football"). */
    sportId: text(),
    /** "U10", "Juniors", "Adults", "Seniors 50+" */
    name: text().notNull(),
    minAge: integer(),
    maxAge: integer(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniq("AgeGroup", t.clubId, t.name),
    fk("AgeGroup", [t.clubId], [club.id]).onDelete("cascade"),
    fk("AgeGroup", [t.sportId], [sport.id]).onDelete("set null"),
    check(
      "AgeGroup_age_bounds",
      sql`("minAge" IS NULL OR "minAge" >= 0) AND ("maxAge" IS NULL OR "maxAge" >= 0) AND ("minAge" IS NULL OR "maxAge" IS NULL OR "minAge" <= "maxAge")`,
    ),
  ],
);

/**
 * Links a user to a club with a club-scoped role. A user may hold several
 * roles in the same club (e.g. STAFF + COACH): one row per role.
 */
export const clubMember = pgTable(
  "ClubMember",
  {
    id: id(),
    clubId: text().notNull(),
    userId: text().notNull(),
    role: clubRole().notNull(),
    status: clubMemberStatus().notNull().default("INVITED"),
    /** Only meaningful for STAFF; OWNER implicitly holds every permission. */
    permissions: clubPermission()
      .array()
      .notNull()
      .default(sql`ARRAY[]::"ClubPermission"[]`),
    /** "Head Coach", "Front Desk" */
    title: text(),
    /** Students are typically placed in an age group / squad. */
    ageGroupId: text(),
    invitedAt: tstz().notNull().defaultNow(),
    joinedAt: tstz(),
    leftAt: tstz(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniq("ClubMember", t.clubId, t.userId, t.role),
    idx("ClubMember", t.userId, t.status),
    idx("ClubMember", t.clubId, t.role, t.status),
    fk("ClubMember", [t.clubId], [club.id]).onDelete("cascade"),
    fk("ClubMember", [t.userId], [user.id]).onDelete("cascade"),
    fk("ClubMember", [t.ageGroupId], [ageGroup.id]).onDelete("set null"),
  ],
);

/** Assigns a coach to a student, a squad (age group) and/or a sport. */
export const coachAssignment = pgTable(
  "CoachAssignment",
  {
    id: id(),
    clubId: text().notNull(),
    coachMemberId: text().notNull(),
    studentMemberId: text(),
    ageGroupId: text(),
    sportId: text(),
    startsOn: date({ mode: "date" }).notNull().defaultNow(),
    endsOn: date({ mode: "date" }),
    createdAt: createdAt(),
  },
  (t) => [
    idx("CoachAssignment", t.clubId),
    idx("CoachAssignment", t.coachMemberId),
    idx("CoachAssignment", t.studentMemberId),
    fk("CoachAssignment", [t.clubId], [club.id]).onDelete("cascade"),
    fk("CoachAssignment", [t.coachMemberId], [clubMember.id]).onDelete("cascade"),
    fk("CoachAssignment", [t.studentMemberId], [clubMember.id]).onDelete("cascade"),
    fk("CoachAssignment", [t.ageGroupId], [ageGroup.id]).onDelete("cascade"),
    fk("CoachAssignment", [t.sportId], [sport.id]).onDelete("cascade"),
    check("CoachAssignment_has_target", sql`"studentMemberId" IS NOT NULL OR "ageGroupId" IS NOT NULL`),
    check("CoachAssignment_date_order", sql`"endsOn" IS NULL OR "endsOn" >= "startsOn"`),
  ],
);

/** A bookable field / court / room. */
export const facility = pgTable(
  "Facility",
  {
    id: id(),
    clubId: text().notNull(),
    /** "Court 3", "Main Pitch" */
    name: text().notNull(),
    type: facilityType().notNull(),
    surface: surfaceType(),
    isIndoor: boolean().notNull().default(false),
    hasLighting: boolean().notNull().default(false),
    /** Max people on the facility at once (used to cap session size). */
    capacity: integer(),
    /** Optional rental price (minor units / hour) used for utilisation revenue. */
    hourlyRateAmount: integer(),
    /** Turnover buffer enforced by the scheduling service around each booking. */
    bufferMinutes: integer().notNull().default(0),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniq("Facility", t.clubId, t.name),
    // Target of the composite FK PracticeSession(facilityId, clubId) → Facility(id, clubId).
    // A UNIQUE constraint, not just an index: it is created with the table,
    // before Drizzle Kit adds foreign keys that reference it.
    unique("Facility_id_clubId_key").on(t.id, t.clubId),
    fk("Facility", [t.clubId], [club.id]).onDelete("cascade"),
    check("Facility_capacity_positive", sql`"capacity" IS NULL OR "capacity" > 0`),
    check("Facility_buffer_non_negative", sql`"bufferMinutes" >= 0`),
    check("Facility_rate_non_negative", sql`"hourlyRateAmount" IS NULL OR "hourlyRateAmount" >= 0`),
  ],
);

export const facilitySport = pgTable(
  "FacilitySport",
  {
    facilityId: text().notNull(),
    sportId: text().notNull(),
  },
  (t) => [
    primaryKey({ name: "FacilitySport_pkey", columns: [t.facilityId, t.sportId] }),
    idx("FacilitySport", t.sportId),
    fk("FacilitySport", [t.facilityId], [facility.id]).onDelete("cascade"),
    fk("FacilitySport", [t.sportId], [sport.id]).onDelete("restrict"),
  ],
);

/**
 * An inventory line. A unique piece (ball machine #2) is quantity = 1;
 * pooled stock (40 tennis balls) is quantity = 40. Bookings consume units.
 */
export const equipment = pgTable(
  "Equipment",
  {
    id: id(),
    clubId: text().notNull(),
    name: text().notNull(),
    /** "Balls", "Cones", "Rackets", "Machines" */
    category: text(),
    sku: text(),
    /** Total bookable units. */
    quantity: integer().notNull().default(1),
    condition: equipmentCondition().notNull().default("GOOD"),
    isActive: boolean().notNull().default(true),
    notes: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniq("Equipment", t.clubId, t.sku),
    unique("Equipment_id_clubId_key").on(t.id, t.clubId),
    idx("Equipment", t.clubId, t.category),
    fk("Equipment", [t.clubId], [club.id]).onDelete("cascade"),
    check("Equipment_quantity_non_negative", sql`"quantity" >= 0`),
  ],
);
