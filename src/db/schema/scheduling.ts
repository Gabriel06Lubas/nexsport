import { sql } from "drizzle-orm";
import { char, check, integer, pgTable, text, unique } from "drizzle-orm/pg-core";

import { createdAt, fk, id, idx, tstz, uniq, updatedAt } from "../columns";
import { user } from "./auth";
import { cancellationPolicy } from "./billing";
import { ageGroup, club, equipment, facility, sport } from "./clubs";
import { attendanceStatus, equipmentBookingStatus, participantStatus, sessionStatus } from "./enums";

// =============================================================================
// SCHEDULING
//
// Two guards live outside this file, in the custom migration
// drizzle/0001_booking_guards.sql, because Drizzle Kit can't express them:
//   * PracticeSession_facility_no_overlap: GiST exclusion constraint, so two
//     non-cancelled sessions never overlap on one facility.
//   * Triggers capping equipment units and session seats, and moving
//     equipment bookings when a session is rescheduled or cancelled.
// =============================================================================

export const practiceSession = pgTable(
  "PracticeSession",
  {
    id: id(),
    clubId: text().notNull(),
    facilityId: text().notNull(),
    coachId: text().notNull(),
    sportId: text().notNull(),
    ageGroupId: text(),
    createdById: text().notNull(),
    title: text().notNull(),
    description: text(),
    startsAt: tstz().notNull(),
    endsAt: tstz().notNull(),
    status: sessionStatus().notNull().default("SCHEDULED"),
    maxParticipants: integer(),
    /** Price per participant in minor units; 0 = free / included in membership. */
    priceAmount: integer().notNull().default(0),
    currency: char({ length: 3 }).notNull().default("eur"),
    /** Coach's share of the post-platform-fee amount, in basis points (7000 = 70%). */
    coachShareBps: integer().notNull().default(0),
    cancellationPolicyId: text(),
    /** Groups occurrences of a recurring session series. */
    seriesId: text(),
    cancelledAt: tstz(),
    cancelledById: text(),
    cancellationReason: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("PracticeSession_id_clubId_key").on(t.id, t.clubId),
    idx("PracticeSession", t.clubId, t.startsAt),
    idx("PracticeSession", t.coachId, t.startsAt),
    idx("PracticeSession", t.facilityId, t.startsAt),
    idx("PracticeSession", t.seriesId),
    fk("PracticeSession", [t.clubId], [club.id]).onDelete("cascade"),
    // Composite FK: the facility must belong to the same club as the session.
    fk("PracticeSession", [t.facilityId, t.clubId], [facility.id, facility.clubId]).onDelete("restrict"),
    fk("PracticeSession", [t.coachId], [user.id]).onDelete("restrict"),
    fk("PracticeSession", [t.createdById], [user.id]).onDelete("restrict"),
    fk("PracticeSession", [t.cancelledById], [user.id]).onDelete("set null"),
    fk("PracticeSession", [t.sportId], [sport.id]).onDelete("restrict"),
    fk("PracticeSession", [t.ageGroupId], [ageGroup.id]).onDelete("set null"),
    fk("PracticeSession", [t.cancellationPolicyId], [cancellationPolicy.id]).onDelete("set null"),
    check("PracticeSession_time_order", sql`"endsAt" > "startsAt"`),
    check("PracticeSession_price_non_negative", sql`"priceAmount" >= 0`),
    check("PracticeSession_currency_format", sql`"currency" ~ '^[a-z]{3}$'`),
    check("PracticeSession_coach_share_bps", sql`"coachShareBps" BETWEEN 0 AND 10000`),
    check("PracticeSession_max_participants_positive", sql`"maxParticipants" IS NULL OR "maxParticipants" > 0`),
    check("PracticeSession_cancellation_consistent", sql`("status" = 'CANCELLED') = ("cancelledAt" IS NOT NULL)`),
  ],
);

export const sessionParticipant = pgTable(
  "SessionParticipant",
  {
    id: id(),
    sessionId: text().notNull(),
    userId: text().notNull(),
    status: participantStatus().notNull().default("INVITED"),
    invitedById: text(),
    invitedAt: tstz().notNull().defaultNow(),
    respondedAt: tstz(),
    cancelledAt: tstz(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniq("SessionParticipant", t.sessionId, t.userId),
    idx("SessionParticipant", t.userId, t.status),
    idx("SessionParticipant", t.sessionId, t.status),
    fk("SessionParticipant", [t.sessionId], [practiceSession.id]).onDelete("cascade"),
    fk("SessionParticipant", [t.userId], [user.id]).onDelete("cascade"),
    fk("SessionParticipant", [t.invitedById], [user.id]).onDelete("set null"),
  ],
);

export const attendance = pgTable(
  "Attendance",
  {
    id: id(),
    sessionId: text().notNull(),
    participantId: text().notNull(),
    userId: text().notNull(),
    status: attendanceStatus().notNull(),
    checkedInAt: tstz(),
    markedById: text(),
    /** Coach → student feedback, visible only to that student. */
    coachFeedback: text(),
    /** 1–5 */
    performanceRating: integer(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniq("Attendance", t.participantId),
    uniq("Attendance", t.sessionId, t.userId),
    idx("Attendance", t.userId, t.createdAt),
    fk("Attendance", [t.sessionId], [practiceSession.id]).onDelete("cascade"),
    fk("Attendance", [t.participantId], [sessionParticipant.id]).onDelete("cascade"),
    fk("Attendance", [t.userId], [user.id]).onDelete("cascade"),
    fk("Attendance", [t.markedById], [user.id]).onDelete("set null"),
    check("Attendance_rating_range", sql`"performanceRating" IS NULL OR "performanceRating" BETWEEN 1 AND 5`),
  ],
);

/**
 * Units of equipment reserved for a practice session. Over-allocation (the
 * sum of overlapping active bookings exceeding Equipment.quantity) is
 * rejected by the `EquipmentBooking_capacity_guard` trigger.
 */
export const equipmentBooking = pgTable(
  "EquipmentBooking",
  {
    id: id(),
    clubId: text().notNull(),
    equipmentId: text().notNull(),
    sessionId: text().notNull(),
    quantity: integer().notNull().default(1),
    /** Copied from the session (optionally widened for setup/teardown). */
    startsAt: tstz().notNull(),
    endsAt: tstz().notNull(),
    status: equipmentBookingStatus().notNull().default("RESERVED"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniq("EquipmentBooking", t.sessionId, t.equipmentId),
    idx("EquipmentBooking", t.equipmentId, t.startsAt, t.endsAt),
    idx("EquipmentBooking", t.clubId),
    fk("EquipmentBooking", [t.clubId], [club.id]).onDelete("cascade"),
    // Composite FKs guarantee equipment + session belong to the same club.
    fk("EquipmentBooking", [t.equipmentId, t.clubId], [equipment.id, equipment.clubId]).onDelete("cascade"),
    fk("EquipmentBooking", [t.sessionId, t.clubId], [practiceSession.id, practiceSession.clubId]).onDelete("cascade"),
    check("EquipmentBooking_quantity_positive", sql`"quantity" > 0`),
    check("EquipmentBooking_time_order", sql`"endsAt" > "startsAt"`),
  ],
);
