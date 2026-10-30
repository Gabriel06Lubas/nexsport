import "server-only";

import { sql } from "drizzle-orm";

import { rows } from "@/modules/clubs/queries/shared";

// A coach's students: everyone assigned to them through a club
// (CoachAssignment) plus everyone who has joined one of their sessions.

const studentIds = (coachId: string) => sql`
  SELECT p."userId", s."clubId" FROM "SessionParticipant" p JOIN "PracticeSession" s ON s.id = p."sessionId"
   WHERE s."coachId" = ${coachId} AND p.status = 'ACCEPTED'
  UNION
  SELECT st."userId", ca."clubId" FROM "CoachAssignment" ca
    JOIN "ClubMember" co ON co.id = ca."coachMemberId"
    JOIN "ClubMember" st ON st.id = ca."studentMemberId"
   WHERE co."userId" = ${coachId} AND (ca."endsOn" IS NULL OR ca."endsOn" >= current_date)`;

export type StudentRow = {
  userId: string;
  name: string | null;
  email: string;
  clubs: string;
  sessions: number;
  marked: number;
  attended: number;
  lastSession: Date | null;
  nextSession: Date | null;
};

export async function listStudents(coachId: string, q: string) {
  const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return rows<StudentRow>(sql`
    WITH ids AS (${studentIds(coachId)}),
    mine AS (
      SELECT p."userId", s.id AS "sessionId", s."startsAt", s.status, a.status AS attendance
        FROM "PracticeSession" s
        JOIN "SessionParticipant" p ON p."sessionId" = s.id AND p.status = 'ACCEPTED'
        LEFT JOIN "Attendance" a ON a."participantId" = p.id
       WHERE s."coachId" = ${coachId} AND s.status <> 'CANCELLED'
    )
    SELECT u.id AS "userId", u.name, u.email,
           (SELECT string_agg(DISTINCT c.name, ', ') FROM ids JOIN "Club" c ON c.id = ids."clubId" WHERE ids."userId" = u.id) AS clubs,
           (SELECT count(*)::int FROM mine WHERE mine."userId" = u.id AND mine."startsAt" <= now()) AS sessions,
           (SELECT count(*)::int FROM mine WHERE mine."userId" = u.id AND mine.attendance IS NOT NULL) AS marked,
           (SELECT count(*)::int FROM mine WHERE mine."userId" = u.id AND mine.attendance IN ('PRESENT', 'LATE')) AS attended,
           (SELECT max("startsAt") FROM mine WHERE mine."userId" = u.id AND mine."startsAt" <= now()) AS "lastSession",
           (SELECT min("startsAt") FROM mine WHERE mine."userId" = u.id AND mine."startsAt" > now()) AS "nextSession"
      FROM "User" u
     WHERE u.id IN (SELECT "userId" FROM ids)
       AND (${q} = '' OR u.email ILIKE ${pattern} ESCAPE '\\' OR u.name ILIKE ${pattern} ESCAPE '\\')
     ORDER BY lower(COALESCE(u.name, u.email))
     LIMIT 200`);
}

export type AttendanceSession = {
  sessionId: string;
  title: string;
  startsAt: Date;
  clubName: string;
  status: string;
  participantId: string;
  studentName: string | null;
  studentEmail: string;
  attendance: "PRESENT" | "LATE" | "ABSENT" | "EXCUSED" | null;
};

/** Participants of the coach's sessions from the last 7 days up to now, for check-in. */
export async function getAttendanceSheet(coachId: string) {
  const list = await rows<AttendanceSession>(sql`
    SELECT s.id AS "sessionId", s.title, s."startsAt", c.name AS "clubName", s.status,
           p.id AS "participantId", u.name AS "studentName", u.email AS "studentEmail", a.status AS attendance
      FROM "PracticeSession" s
      JOIN "Club" c ON c.id = s."clubId"
      JOIN "SessionParticipant" p ON p."sessionId" = s.id AND p.status = 'ACCEPTED'
      JOIN "User" u ON u.id = p."userId"
      LEFT JOIN "Attendance" a ON a."participantId" = p.id
     WHERE s."coachId" = ${coachId} AND s.status <> 'CANCELLED'
       AND s."startsAt" <= now() + interval '30 minutes' AND s."startsAt" > now() - interval '7 days'
     ORDER BY s."startsAt" DESC, lower(COALESCE(u.name, u.email))`);
  return list.map((r) => ({ ...r, startsAt: new Date(r.startsAt) }));
}

export type StudentPass = {
  passId: string;
  userId: string;
  studentName: string | null;
  studentEmail: string;
  clubName: string;
  planName: string;
  creditsTotal: number | null;
  creditsUsed: number;
  expiresAt: Date;
  valid: boolean;
};

/**
 * Passes of the coach's students at clubs where the coach is on the roster
 * (the only passes a coach may adjust), current ones first.
 */
export async function getStudentPasses(coachId: string) {
  const list = await rows<StudentPass>(sql`
    WITH ids AS (${studentIds(coachId)}),
    clubs AS (SELECT "clubId" FROM "ClubMember" WHERE "userId" = ${coachId} AND role = 'COACH' AND status = 'ACTIVE')
    SELECT mp.id AS "passId", u.id AS "userId", u.name AS "studentName", u.email AS "studentEmail", c.name AS "clubName", pl.name AS "planName",
           mp."creditsTotal", mp."creditsUsed", mp."expiresAt",
           (mp."cancelledAt" IS NULL AND mp."startsAt" <= now() AND mp."expiresAt" > now()) AS valid
      FROM "MemberPass" mp
      JOIN "MembershipPlan" pl ON pl.id = mp."planId"
      JOIN "Club" c ON c.id = mp."clubId"
      JOIN "User" u ON u.id = mp."userId"
     WHERE mp."clubId" IN (SELECT "clubId" FROM clubs)
       AND (mp."userId", mp."clubId") IN (SELECT "userId", "clubId" FROM ids)
       AND mp."expiresAt" > now() - interval '30 days'
     ORDER BY valid DESC, mp."expiresAt"`);
  return list.map((p) => ({ ...p, expiresAt: new Date(p.expiresAt) }));
}

export async function getRecentAdjustments(coachId: string) {
  const list = await rows<{ id: string; delta: number; reason: string; createdAt: Date; studentEmail: string; planName: string }>(sql`
    SELECT adj.id, adj.delta, adj.reason, adj."createdAt", u.email AS "studentEmail", pl.name AS "planName"
      FROM "PassCreditAdjustment" adj
      JOIN "MemberPass" mp ON mp.id = adj."passId"
      JOIN "MembershipPlan" pl ON pl.id = mp."planId"
      JOIN "User" u ON u.id = mp."userId"
     WHERE adj."actorId" = ${coachId}
     ORDER BY adj."createdAt" DESC
     LIMIT 10`);
  return list.map((a) => ({ ...a, createdAt: new Date(a.createdAt) }));
}

/** Whether a user counts as one of the coach's students at a club (for credit changes). */
export async function isStudentAt(coachId: string, userId: string, clubId: string) {
  const [row] = await rows<{ ok: boolean }>(sql`
    SELECT EXISTS (SELECT 1 FROM (${studentIds(coachId)}) ids WHERE ids."userId" = ${userId} AND ids."clubId" = ${clubId}) AS ok`);
  return !!row?.ok;
}
