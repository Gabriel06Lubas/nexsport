import "server-only";

import { sql } from "drizzle-orm";

import { rows } from "@/modules/clubs/queries/shared";

// Read models for the coach dashboard. Everything is filtered on the signed-in
// coach's user id; values from the URL are bound parameters.
//
// Definitions (also in docs/coach-dashboard.md):
//   * Hours scheduled: non-cancelled sessions the coach runs, starting in the
//     period (coach's time zone).
//   * Pending earnings: the coach's Stripe Connect transfers still PENDING.
//   * Attendance rate: of attendance marked on the coach's sessions in the
//     last 90 days, the share marked PRESENT or LATE.

export type CoachSession = {
  id: string;
  title: string;
  kind: "PRIVATE" | "GROUP" | "OPEN_MATCH";
  status: "DRAFT" | "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  startsAt: Date;
  endsAt: Date;
  clubName: string;
  clubSlug: string;
  facilityName: string;
  maxParticipants: number | null;
  participants: number;
  priceAmount: number;
  currency: string;
  students: string | null;
};

export async function getCoachSessions(coachId: string, from: Date, to: Date) {
  const list = await rows<CoachSession>(sql`
    SELECT s.id, s.title, s.kind, s.status, s."startsAt", s."endsAt", c.name AS "clubName", c.slug AS "clubSlug", f.name AS "facilityName",
           s."maxParticipants", s."priceAmount", s.currency,
           count(p.id) FILTER (WHERE p.status = 'ACCEPTED')::int AS participants,
           string_agg(COALESCE(u.name, u.email), ', ' ORDER BY COALESCE(u.name, u.email)) FILTER (WHERE p.status = 'ACCEPTED') AS students
      FROM "PracticeSession" s
      JOIN "Club" c ON c.id = s."clubId"
      JOIN "Facility" f ON f.id = s."facilityId"
      LEFT JOIN "SessionParticipant" p ON p."sessionId" = s.id
      LEFT JOIN "User" u ON u.id = p."userId"
     WHERE s."coachId" = ${coachId} AND s."startsAt" < ${to} AND s."endsAt" > ${from}
     GROUP BY s.id, c.id, f.id
     ORDER BY s."startsAt"`);
  return list.map((s) => ({ ...s, startsAt: new Date(s.startsAt), endsAt: new Date(s.endsAt) }));
}

/** Sessions that have started but were never completed or cancelled. */
export async function getSessionsToWrapUp(coachId: string) {
  const list = await rows<{ id: string; title: string; startsAt: Date; clubName: string; marked: number; participants: number }>(sql`
    SELECT s.id, s.title, s."startsAt", c.name AS "clubName",
           count(a.id)::int AS marked, count(p.id) FILTER (WHERE p.status = 'ACCEPTED')::int AS participants
      FROM "PracticeSession" s
      JOIN "Club" c ON c.id = s."clubId"
      LEFT JOIN "SessionParticipant" p ON p."sessionId" = s.id
      LEFT JOIN "Attendance" a ON a."participantId" = p.id
     WHERE s."coachId" = ${coachId} AND s.status IN ('SCHEDULED', 'IN_PROGRESS') AND s."startsAt" <= now()
     GROUP BY s.id, c.id
     ORDER BY s."startsAt" DESC
     LIMIT 20`);
  return list.map((s) => ({ ...s, startsAt: new Date(s.startsAt) }));
}

/** `currency`: the coach's, for the pending-payout total (amounts in other currencies aren't added to it). */
export async function getCoachKpis(coachId: string, currency: string, ranges: { weekFrom: Date; weekTo: Date; monthFrom: Date; monthTo: Date }) {
  const [k] = await rows<{
    weekHours: number;
    monthHours: number;
    weekSessions: number;
    pending: number;
    pendingCount: number;
    marked: number;
    attended: number;
  }>(sql`
    WITH s AS (SELECT * FROM "PracticeSession" WHERE "coachId" = ${coachId} AND status <> 'CANCELLED')
    SELECT
      COALESCE((SELECT sum(extract(epoch FROM "endsAt" - "startsAt")) / 3600 FROM s WHERE "startsAt" >= ${ranges.weekFrom} AND "startsAt" < ${ranges.weekTo}), 0)::float8 AS "weekHours",
      COALESCE((SELECT sum(extract(epoch FROM "endsAt" - "startsAt")) / 3600 FROM s WHERE "startsAt" >= ${ranges.monthFrom} AND "startsAt" < ${ranges.monthTo}), 0)::float8 AS "monthHours",
      (SELECT count(*)::int FROM s WHERE "startsAt" >= ${ranges.weekFrom} AND "startsAt" < ${ranges.weekTo}) AS "weekSessions",
      COALESCE((SELECT sum(tr.amount) FROM "PaymentTransfer" tr
                  JOIN "PaymentTransaction" pt ON pt.id = tr."paymentId"
                  JOIN "StripeAccount" sa ON sa.id = tr."stripeAccountId"
                 WHERE sa."userId" = ${coachId} AND tr."recipientType" = 'COACH' AND tr.status = 'PENDING' AND tr.currency = ${currency}), 0)::float8 AS pending,
      (SELECT count(*)::int FROM "PaymentTransfer" tr JOIN "StripeAccount" sa ON sa.id = tr."stripeAccountId"
        WHERE sa."userId" = ${coachId} AND tr."recipientType" = 'COACH' AND tr.status = 'PENDING' AND tr.currency = ${currency}) AS "pendingCount",
      (SELECT count(*)::int FROM "Attendance" a JOIN s ON s.id = a."sessionId" WHERE s."startsAt" > now() - interval '90 days') AS marked,
      (SELECT count(*)::int FROM "Attendance" a JOIN s ON s.id = a."sessionId"
        WHERE s."startsAt" > now() - interval '90 days' AND a.status IN ('PRESENT', 'LATE')) AS attended`);
  return { ...k!, attendanceRate: k!.marked > 0 ? k!.attended / k!.marked : null };
}

/** Facilities, sports and equipment the coach can use in the new-session form. */
export async function getSessionFormOptions(clubIds: string[]) {
  if (clubIds.length === 0) return { facilities: [], sports: [], equipment: [] };
  const ids = sql.join(clubIds.map((id) => sql`${id}`), sql`, `);
  const [facilities, sports, equipment] = await Promise.all([
    rows<{ id: string; clubId: string; label: string }>(sql`
      SELECT f.id, f."clubId", c.name || ' · ' || f.name AS label FROM "Facility" f JOIN "Club" c ON c.id = f."clubId"
       WHERE f."clubId" IN (${ids}) AND f."isActive" ORDER BY c.name, f.name`),
    rows<{ id: string; label: string }>(sql`SELECT id, name AS label FROM "Sport" WHERE "isActive" ORDER BY name`),
    rows<{ id: string; clubId: string; label: string }>(sql`
      SELECT e.id, e."clubId", c.name || ' · ' || e.name || ' (' || e.quantity || ')' AS label FROM "Equipment" e JOIN "Club" c ON c.id = e."clubId"
       WHERE e."clubId" IN (${ids}) AND e."isActive" AND e.condition NOT IN ('RETIRED', 'NEEDS_REPAIR') ORDER BY c.name, e.name`),
  ]);
  return { facilities, sports, equipment };
}

export type SessionAthlete = {
  participantId: string;
  userId: string;
  status: "INVITED" | "ACCEPTED" | "DECLINED" | "WAITLISTED" | "CANCELLED" | "REMOVED";
  name: string | null;
  email: string;
  phone: string | null;
  handle: string | null;
  levelRating: number | null;
  level: string | null;
  attendance: "PRESENT" | "LATE" | "ABSENT" | "EXCUSED" | null;
  feedback: string | null;
  rating: number | null;
  paymentStatus: string | null;
  paymentAmount: number | null;
  /** Earlier sessions (not cancelled) with this coach, and when the last one was. */
  previous: number;
  lastAt: Date | null;
};

/**
 * One session the coach runs, with everything the session page shows: where
 * (club address, court), who (athletes with contact details, level for the
 * session's sport, attendance, payment, history with this coach) and what's
 * reserved. Null when it isn't the coach's session, so another coach's id is
 * a 404. The phone number is shown here because these are the coach's own
 * athletes (docs/onboarding.md: who may see a phone number).
 */
export async function getCoachSessionDetail(coachId: string, sessionId: string) {
  const [session] = await rows<{
    id: string;
    title: string;
    description: string | null;
    kind: CoachSession["kind"];
    status: CoachSession["status"];
    startsAt: Date;
    endsAt: Date;
    maxParticipants: number | null;
    priceAmount: number;
    currency: string;
    minLevel: number | null;
    maxLevel: number | null;
    cancellationReason: string | null;
    sportId: string;
    sportName: string;
    facilityName: string;
    clubName: string;
    clubTimezone: string;
    clubPhone: string | null;
    addressLine1: string | null;
    city: string | null;
    postalCode: string | null;
    country: string;
  }>(sql`
    SELECT s.id, s.title, s.description, s.kind, s.status, s."startsAt", s."endsAt", s."maxParticipants", s."priceAmount", s.currency,
           s."minLevel"::float8 AS "minLevel", s."maxLevel"::float8 AS "maxLevel", s."cancellationReason", s."sportId", sp.name AS "sportName", f.name AS "facilityName",
           c.name AS "clubName", c.timezone AS "clubTimezone", c.phone AS "clubPhone", c."addressLine1", c.city, c."postalCode", c.country
      FROM "PracticeSession" s
      JOIN "Club" c ON c.id = s."clubId"
      JOIN "Facility" f ON f.id = s."facilityId"
      JOIN "Sport" sp ON sp.id = s."sportId"
     WHERE s.id = ${sessionId} AND s."coachId" = ${coachId}`);
  if (!session) return null;

  const [athletes, equipment] = await Promise.all([
    rows<SessionAthlete>(sql`
      SELECT p.id AS "participantId", p."userId", p.status, u.name, u.email, pr.phone, pr.handle,
             ps."levelRating"::float8 AS "levelRating", ps.level, a.status AS attendance, a."coachFeedback" AS feedback, a."performanceRating" AS rating,
             pay.status AS "paymentStatus", pay.amount AS "paymentAmount",
             hist.previous, hist."lastAt"
        FROM "SessionParticipant" p
        JOIN "User" u ON u.id = p."userId"
        LEFT JOIN "Profile" pr ON pr."userId" = u.id
        LEFT JOIN "ProfileSport" ps ON ps."profileId" = pr.id AND ps."sportId" = ${session.sportId}
        LEFT JOIN "Attendance" a ON a."participantId" = p.id
        LEFT JOIN LATERAL (
          SELECT pt.status::text, pt.amount FROM "PaymentTransaction" pt
           WHERE pt."participantId" = p.id ORDER BY (pt.status = 'SUCCEEDED') DESC, pt."createdAt" DESC LIMIT 1
        ) pay ON true
        LEFT JOIN LATERAL (
          SELECT count(*)::int AS previous, max(s2."startsAt") AS "lastAt"
            FROM "SessionParticipant" p2 JOIN "PracticeSession" s2 ON s2.id = p2."sessionId"
           WHERE p2."userId" = p."userId" AND p2.status = 'ACCEPTED' AND s2."coachId" = ${coachId}
             AND s2.status <> 'CANCELLED' AND s2."startsAt" < ${new Date(session.startsAt)}
        ) hist ON true
       WHERE p."sessionId" = ${sessionId} AND p.status IN ('ACCEPTED', 'INVITED', 'WAITLISTED')
       ORDER BY p.status, COALESCE(u.name, u.email)`),
    rows<{ name: string; quantity: number }>(sql`
      SELECT e.name, eb.quantity FROM "EquipmentBooking" eb JOIN "Equipment" e ON e.id = eb."equipmentId"
       WHERE eb."sessionId" = ${sessionId} AND eb.status <> 'CANCELLED' ORDER BY e.name`),
  ]);

  return {
    ...session,
    startsAt: new Date(session.startsAt),
    endsAt: new Date(session.endsAt),
    athletes: athletes.map((a) => ({ ...a, lastAt: a.lastAt ? new Date(a.lastAt) : null })),
    equipment,
  };
}

export type CoachSessionDetail = NonNullable<Awaited<ReturnType<typeof getCoachSessionDetail>>>;
