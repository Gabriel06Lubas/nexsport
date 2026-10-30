import "server-only";

import { sql } from "drizzle-orm";

import { rows } from "@/modules/clubs/queries/shared";

import { openSlots, type Interval, type SlotFacility, type SlotWindow } from "../lib/slots";

export async function listWindows(coachId: string) {
  return rows<{ id: string; dayOfWeek: number; startMinute: number; endMinute: number; clubId: string; clubName: string; facilityName: string | null; timezone: string }>(sql`
    SELECT w.id, w."dayOfWeek", w."startMinute", w."endMinute", w."clubId", c.name AS "clubName", f.name AS "facilityName", c.timezone
      FROM "CoachAvailability" w JOIN "Club" c ON c.id = w."clubId" LEFT JOIN "Facility" f ON f.id = w."facilityId"
     WHERE w."coachId" = ${coachId}
     ORDER BY w."dayOfWeek", w."startMinute"`);
}

export type PublicCoach = {
  userId: string;
  name: string | null;
  slug: string;
  headline: string | null;
  bio: string | null;
  privateRateAmount: number;
  groupRateAmount: number | null;
  currency: string;
  sessionMinutes: number;
  minNoticeHours: number;
  maxAdvanceDays: number;
  sportId: string;
  sportName: string;
};

/** A coach whose public booking page is switched on, or null. */
export async function getPublicCoach(slug: string) {
  const [coach] = await rows<PublicCoach>(sql`
    SELECT p."userId", u.name, p.slug, p.headline, p.bio, p."privateRateAmount", p."groupRateAmount", p.currency,
           p."sessionMinutes", p."minNoticeHours", p."maxAdvanceDays", p."sportId", s.name AS "sportName"
      FROM "CoachProfile" p JOIN "User" u ON u.id = p."userId" JOIN "Sport" s ON s.id = p."sportId"
     WHERE p.slug = ${slug} AND p."bookingEnabled" AND u.role = 'COACH' AND u."suspendedAt" IS NULL AND u."deletedAt" IS NULL`);
  return coach ?? null;
}

/**
 * Open slots for a coach right now. Only windows at clubs where the coach is
 * still an active coach and the club is open for business count.
 */
export async function getOpenSlots(coach: Pick<PublicCoach, "userId" | "sessionMinutes" | "minNoticeHours" | "maxAdvanceDays">, now = new Date()) {
  const windows = await rows<SlotWindow>(sql`
    SELECT w."clubId", c.timezone AS "timeZone", w."facilityId", w."dayOfWeek", w."startMinute", w."endMinute"
      FROM "CoachAvailability" w
      JOIN "Club" c ON c.id = w."clubId" AND c."deletedAt" IS NULL AND c.status IN ('ACTIVE', 'PENDING_SETUP')
      JOIN "ClubMember" m ON m."clubId" = w."clubId" AND m."userId" = w."coachId" AND m.role = 'COACH' AND m.status = 'ACTIVE'
     WHERE w."coachId" = ${coach.userId}`);
  if (windows.length === 0) return [];
  const clubIds = sql.join([...new Set(windows.map((w) => w.clubId))].map((id) => sql`${id}`), sql`, `);
  const until = new Date(now.getTime() + (coach.maxAdvanceDays + 1) * 86_400_000);
  const [facilities, coachBusy, facilityBusy] = await Promise.all([
    rows<SlotFacility>(sql`SELECT id, "clubId", "openMinute", "closeMinute" FROM "Facility" WHERE "clubId" IN (${clubIds}) AND "isActive" ORDER BY name`),
    rows<{ start: Date; end: Date }>(sql`
      SELECT "startsAt" AS start, "endsAt" AS end FROM "PracticeSession"
       WHERE "coachId" = ${coach.userId} AND status <> 'CANCELLED' AND "endsAt" > ${now} AND "startsAt" < ${until}`),
    rows<{ facilityId: string; start: Date; end: Date }>(sql`
      SELECT "facilityId", "startsAt" AS start, "endsAt" AS end FROM "PracticeSession"
       WHERE "clubId" IN (${clubIds}) AND status <> 'CANCELLED' AND "endsAt" > ${now} AND "startsAt" < ${until}
      UNION ALL
      SELECT "facilityId", "startsAt", "endsAt" FROM "FacilityBooking"
       WHERE "clubId" IN (${clubIds}) AND status <> 'CANCELLED' AND "endsAt" > ${now} AND "startsAt" < ${until}`),
  ]);
  const toInterval = (r: { start: Date; end: Date }): Interval => ({ start: new Date(r.start).getTime(), end: new Date(r.end).getTime() });
  const busy = new Map<string, Interval[]>();
  for (const r of facilityBusy) busy.set(r.facilityId, [...(busy.get(r.facilityId) ?? []), toInterval(r)]);
  return openSlots({
    windows,
    facilities,
    sessionMinutes: coach.sessionMinutes,
    now,
    minNoticeHours: coach.minNoticeHours,
    maxAdvanceDays: coach.maxAdvanceDays,
    coachBusy: coachBusy.map(toInterval),
    facilityBusy: busy,
  });
}

export async function clubNames(ids: string[]) {
  if (ids.length === 0) return new Map<string, { name: string; timezone: string; city: string | null }>();
  const list = await rows<{ id: string; name: string; timezone: string; city: string | null }>(sql`
    SELECT id, name, timezone, city FROM "Club" WHERE id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`);
  return new Map(list.map((c) => [c.id, c]));
}

/** A session the student booked with this coach, for the confirmation banner; null otherwise. */
export async function getBookingFor(sessionId: string, studentId: string, coachId: string) {
  if (!/^[a-z0-9]{1,64}$/.test(sessionId)) return null;
  const [row] = await rows<{ startsAt: Date; endsAt: Date; priceAmount: number; currency: string; clubName: string; facilityName: string; timezone: string }>(sql`
    SELECT s."startsAt", s."endsAt", s."priceAmount", s.currency, c.name AS "clubName", f.name AS "facilityName", c.timezone
      FROM "PracticeSession" s
      JOIN "SessionParticipant" p ON p."sessionId" = s.id AND p."userId" = ${studentId}
      JOIN "Club" c ON c.id = s."clubId" JOIN "Facility" f ON f.id = s."facilityId"
     WHERE s.id = ${sessionId} AND s."coachId" = ${coachId}`);
  return row ? { ...row, startsAt: new Date(row.startsAt), endsAt: new Date(row.endsAt) } : null;
}
