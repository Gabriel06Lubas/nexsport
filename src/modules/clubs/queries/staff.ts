import "server-only";

import { sql } from "drizzle-orm";

import type { ClubPermission, EmploymentType } from "@/db/schema/enums";

import { addDays, zonedParts, zonedToUtc } from "../lib/zoned-time";
import { rows, type ClubRef } from "./shared";

export type RosterMember = {
  id: string;
  userId: string;
  name: string | null;
  email: string;
  role: "OWNER" | "STAFF" | "COACH";
  status: "INVITED" | "ACTIVE" | "SUSPENDED";
  title: string | null;
  employmentType: EmploymentType | null;
  hourlyWageAmount: number | null;
  commissionBps: number | null;
  permissions: ClubPermission[];
  joinedAt: Date | null;
  connectStatus: string | null;
  payoutsEnabled: boolean | null;
};

export async function listRoster(clubId: string) {
  // permissions::text[]: node-postgres parses text[] into an array, but not an
  // array of a custom enum type.
  return rows<RosterMember>(sql`
    SELECT cm.id, u.id AS "userId", u.name, u.email, cm.role, cm.status, cm.title, cm."employmentType",
           cm."hourlyWageAmount", cm."commissionBps", cm.permissions::text[] AS permissions, cm."joinedAt",
           sa.status AS "connectStatus", sa."payoutsEnabled"
      FROM "ClubMember" cm
      JOIN "User" u ON u.id = cm."userId"
      LEFT JOIN "StripeAccount" sa ON sa."userId" = u.id
     WHERE cm."clubId" = ${clubId} AND cm.role IN ('OWNER', 'STAFF', 'COACH') AND cm.status <> 'LEFT'
     ORDER BY CASE cm.role WHEN 'OWNER' THEN 0 WHEN 'STAFF' THEN 1 ELSE 2 END, lower(COALESCE(u.name, u.email))`);
}

/** "2026-10" → the instants bounding that month in the club's time zone. */
export function monthRange(month: string, timeZone: string) {
  const first = `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const next = m === 12 ? `${y! + 1}-01-01` : `${y}-${String(m! + 1).padStart(2, "0")}-01`;
  return { from: zonedToUtc(first, 0, timeZone)!, to: zonedToUtc(next, 0, timeZone)! };
}

export function currentMonth(timeZone: string) {
  return zonedParts(new Date(), timeZone).dateKey.slice(0, 7);
}

export function previousMonth(month: string) {
  return addDays(`${month}-01`, -1).slice(0, 7);
}

export type PayrollLine = {
  userId: string;
  sessions: number;
  hours: number;
  /** Paid session revenue (after refunds) for this coach's sessions. */
  gross: number;
  platformFees: number;
  coachPaid: number;
  coachPending: number;
  coachFailed: number;
  clubShare: number;
};

/**
 * Billable hours and Stripe Connect splits per coach for one month: completed
 * sessions that started in the month, and the transfers made from their
 * payments (coach share and club share).
 */
export async function getPayroll(club: ClubRef, month: string) {
  const { from, to } = monthRange(month, club.timezone);
  const lines = await rows<PayrollLine>(sql`
    WITH s AS (
      SELECT id, "coachId", "startsAt", "endsAt" FROM "PracticeSession"
       WHERE "clubId" = ${club.id} AND status = 'COMPLETED' AND "startsAt" >= ${from} AND "startsAt" < ${to}
    ),
    hours AS (
      SELECT "coachId", count(*)::int AS sessions, (sum(extract(epoch FROM "endsAt" - "startsAt")) / 3600)::float8 AS hours
        FROM s GROUP BY 1
    ),
    money AS (
      SELECT s."coachId", sum(pt.amount - pt."refundedAmount")::float8 AS gross, sum(pt."applicationFeeAmount")::float8 AS "platformFees"
        FROM s JOIN "PaymentTransaction" pt ON pt."sessionId" = s.id AND pt.status = 'SUCCEEDED' AND pt.currency = ${club.currency}
       GROUP BY 1
    ),
    splits AS (
      SELECT s."coachId",
             COALESCE(sum(tr.amount - tr."reversedAmount") FILTER (WHERE tr."recipientType" = 'COACH' AND tr.status = 'PAID'), 0)::float8 AS "coachPaid",
             COALESCE(sum(tr.amount) FILTER (WHERE tr."recipientType" = 'COACH' AND tr.status = 'PENDING'), 0)::float8 AS "coachPending",
             COALESCE(sum(tr.amount) FILTER (WHERE tr."recipientType" = 'COACH' AND tr.status IN ('FAILED', 'REVERSED')), 0)::float8 AS "coachFailed",
             COALESCE(sum(tr.amount - tr."reversedAmount") FILTER (WHERE tr."recipientType" = 'CLUB' AND tr.status IN ('PENDING', 'PAID')), 0)::float8 AS "clubShare"
        FROM s
        JOIN "PaymentTransaction" pt ON pt."sessionId" = s.id AND pt.status = 'SUCCEEDED' AND pt.currency = ${club.currency}
        JOIN "PaymentTransfer" tr ON tr."paymentId" = pt.id
       GROUP BY 1
    )
    SELECT hours."coachId" AS "userId", hours.sessions, hours.hours,
           COALESCE(money.gross, 0)::float8 AS gross, COALESCE(money."platformFees", 0)::float8 AS "platformFees",
           COALESCE(splits."coachPaid", 0)::float8 AS "coachPaid", COALESCE(splits."coachPending", 0)::float8 AS "coachPending",
           COALESCE(splits."coachFailed", 0)::float8 AS "coachFailed", COALESCE(splits."clubShare", 0)::float8 AS "clubShare"
      FROM hours
      LEFT JOIN money ON money."coachId" = hours."coachId"
      LEFT JOIN splits ON splits."coachId" = hours."coachId"`);
  return new Map(lines.map((l) => [l.userId, l]));
}

/** Wages an employee earned: billable hours × hourly wage, in minor units. */
export function wagesDue(hours: number, hourlyWage: number | null) {
  return hourlyWage === null ? 0 : Math.round(hours * hourlyWage);
}

export type PayoutReportRow = {
  name: string;
  email: string;
  role: string;
  employment: string;
  sessions: number;
  hours: number;
  gross: number;
  platformFees: number;
  coachPaid: number;
  coachPending: number;
  coachFailed: number;
  clubShare: number;
  hourlyWage: number | null;
  commissionBps: number | null;
  wagesDue: number;
};

/**
 * Session hours belong to a person, not a roster row: someone who is both
 * STAFF and COACH gets them on the COACH row only, so they're never counted twice.
 */
export function payrollLookup(roster: RosterMember[], payroll: Map<string, PayrollLine>) {
  const coaches = new Set(roster.filter((m) => m.role === "COACH").map((m) => m.userId));
  return (m: RosterMember) => (m.role === "COACH" || !coaches.has(m.userId) ? payroll.get(m.userId) : undefined);
}

/** The payout report: one row per staff member and coach on the roster. */
export async function getPayoutReport(club: ClubRef, month: string): Promise<PayoutReportRow[]> {
  const [roster, payroll] = await Promise.all([listRoster(club.id), getPayroll(club, month)]);
  const lineFor = payrollLookup(roster, payroll);
  return roster
    .filter((m) => m.role !== "OWNER" || lineFor(m))
    .map((m) => {
      const p = lineFor(m);
      const hours = p?.hours ?? 0;
      return {
        name: m.name ?? m.email,
        email: m.email,
        role: m.role,
        employment: m.employmentType ?? "",
        sessions: p?.sessions ?? 0,
        hours,
        gross: p?.gross ?? 0,
        platformFees: p?.platformFees ?? 0,
        coachPaid: p?.coachPaid ?? 0,
        coachPending: p?.coachPending ?? 0,
        coachFailed: p?.coachFailed ?? 0,
        clubShare: p?.clubShare ?? 0,
        hourlyWage: m.hourlyWageAmount,
        commissionBps: m.commissionBps,
        wagesDue: m.employmentType === "EMPLOYEE" ? wagesDue(hours, m.hourlyWageAmount) : 0,
      };
    });
}

/** RFC 4180 CSV, with spreadsheet formula injection neutralised. */
export function toCsv(header: string[], data: (string | number | null)[][]): string {
  const cell = (value: string | number | null) => {
    let text = value === null ? "" : String(value);
    // A cell starting with = + - @ (or tab / CR) runs as a formula in Excel.
    if (/^[=+\-@\t\r]/.test(text) && typeof value === "string") text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [header, ...data].map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}
