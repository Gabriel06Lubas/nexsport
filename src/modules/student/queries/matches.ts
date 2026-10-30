import "server-only";

import { sql } from "drizzle-orm";

import { rows } from "@/modules/clubs/queries/shared";

// The open-match board: upcoming OPEN_MATCH sessions with free seats (or the
// student's own), at clubs that are open for business.

export type OpenMatch = {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  sportId: string;
  sportName: string;
  clubId: string;
  clubName: string;
  city: string | null;
  timezone: string;
  facilityName: string;
  coachName: string | null;
  minLevel: number | null;
  maxLevel: number | null;
  maxParticipants: number | null;
  players: number;
  priceAmount: number;
  currency: string;
  joined: boolean;
};

export async function listOpenMatches(userId: string, filter: { sportId: string | null; clubId: string | null; days: number }) {
  const list = await rows<OpenMatch>(sql`
    SELECT s.id, s.title, s."startsAt", s."endsAt", sp.id AS "sportId", sp.name AS "sportName", c.id AS "clubId", c.name AS "clubName", c.city, c.timezone,
           f.name AS "facilityName", COALESCE(co.name, co.email) AS "coachName",
           s."minLevel"::float8 AS "minLevel", s."maxLevel"::float8 AS "maxLevel", s."maxParticipants", s."priceAmount", s.currency,
           count(p.id) FILTER (WHERE p.status = 'ACCEPTED')::int AS players,
           bool_or(p."userId" = ${userId} AND p.status = 'ACCEPTED') IS TRUE AS joined
      FROM "PracticeSession" s
      JOIN "Sport" sp ON sp.id = s."sportId"
      JOIN "Club" c ON c.id = s."clubId" AND c."deletedAt" IS NULL AND c.status IN ('ACTIVE', 'PENDING_SETUP')
      JOIN "Facility" f ON f.id = s."facilityId"
      JOIN "User" co ON co.id = s."coachId"
      LEFT JOIN "SessionParticipant" p ON p."sessionId" = s.id
     WHERE s.kind = 'OPEN_MATCH' AND s.status = 'SCHEDULED' AND s."startsAt" > now()
       AND s."startsAt" < now() + make_interval(days => ${filter.days})
       AND (${filter.sportId}::text IS NULL OR s."sportId" = ${filter.sportId})
       AND (${filter.clubId}::text IS NULL OR s."clubId" = ${filter.clubId})
     GROUP BY s.id, sp.id, c.id, f.id, co.id
     ORDER BY s."startsAt"
     LIMIT 100`);
  return list.map((m) => ({ ...m, startsAt: new Date(m.startsAt), endsAt: new Date(m.endsAt) }));
}

/** The student's level per sport (from their profile). */
export async function getMyLevels(userId: string) {
  const list = await rows<{ sportId: string; levelRating: number | null }>(sql`
    SELECT ps."sportId", ps."levelRating"::float8 AS "levelRating"
      FROM "ProfileSport" ps JOIN "Profile" pr ON pr.id = ps."profileId" WHERE pr."userId" = ${userId}`);
  return new Map(list.map((l) => [l.sportId, l.levelRating]));
}

export async function listSports() {
  return rows<{ id: string; name: string }>(sql`SELECT id, name FROM "Sport" WHERE "isActive" ORDER BY name`);
}

/** Clubs with open matches coming up, plus the student's preferred clubs. */
export async function listMatchClubs(userId: string) {
  return rows<{ id: string; name: string; preferred: boolean }>(sql`
    SELECT c.id, c.name, EXISTS (SELECT 1 FROM "AthletePreferredClub" ap WHERE ap."userId" = ${userId} AND ap."clubId" = c.id) AS preferred
      FROM "Club" c
     WHERE c."deletedAt" IS NULL AND c.status IN ('ACTIVE', 'PENDING_SETUP')
       AND (EXISTS (SELECT 1 FROM "PracticeSession" s WHERE s."clubId" = c.id AND s.kind = 'OPEN_MATCH' AND s.status = 'SCHEDULED' AND s."startsAt" > now())
            OR EXISTS (SELECT 1 FROM "AthletePreferredClub" ap WHERE ap."userId" = ${userId} AND ap."clubId" = c.id))
     ORDER BY c.name`);
}

export async function getMySettings(userId: string) {
  const [settings] = await rows<{ matchAlerts: boolean; bookingUpdates: boolean }>(sql`
    SELECT "matchAlerts", "bookingUpdates" FROM "AthleteSettings" WHERE "userId" = ${userId}`);
  const clubs = await rows<{ id: string; name: string; city: string | null; preferred: boolean }>(sql`
    SELECT c.id, c.name, c.city, (ap."clubId" IS NOT NULL) AS preferred
      FROM "Club" c LEFT JOIN "AthletePreferredClub" ap ON ap."clubId" = c.id AND ap."userId" = ${userId}
     WHERE c."deletedAt" IS NULL AND c.status IN ('ACTIVE', 'PENDING_SETUP')
     ORDER BY (ap."clubId" IS NOT NULL) DESC, c.name
     LIMIT 50`);
  return { matchAlerts: settings?.matchAlerts ?? true, bookingUpdates: settings?.bookingUpdates ?? true, clubs };
}
