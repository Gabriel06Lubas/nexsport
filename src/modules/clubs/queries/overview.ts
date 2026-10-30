import "server-only";

import { sql } from "drizzle-orm";

import { rows, type ClubRef } from "./shared";

// Club overview KPIs. Definitions (also in docs/club-dashboard.md):
//   * Utilisation: hours booked (coached sessions + court rentals, not
//     cancelled) in the last 30 days, over opening hours of active
//     facilities in the same 30 days.
//   * Revenue: money that reaches the club, in the club's currency, by month
//     (club time zone) of payment: Stripe Connect transfers to the club
//     (pending or paid, net of reversals) plus payments taken at the desk.
//     Court rentals, coaching commissions (the club's share of paid
//     sessions) and membership sales are reported separately.
//   * Active members: STUDENT members with status ACTIVE.
//   * Pass holders: members with a pass valid now (started, not expired,
//     not cancelled, credits left).

/** Bookings that occupy a facility: coached sessions and court rentals. */
const occupancy = (clubId: string) => sql`
  SELECT "facilityId", "startsAt", "endsAt" FROM "PracticeSession" WHERE "clubId" = ${clubId} AND status <> 'CANCELLED'
  UNION ALL
  SELECT "facilityId", "startsAt", "endsAt" FROM "FacilityBooking" WHERE "clubId" = ${clubId} AND status <> 'CANCELLED'`;

export type FacilityUtilisation = { id: string; name: string; availableHours: number; bookedHours: number };

export async function getUtilisation(club: ClubRef) {
  const facilities = await rows<FacilityUtilisation>(sql`
    WITH b AS (${occupancy(club.id)})
    SELECT f.id, f.name,
           (f."closeMinute" - f."openMinute") * 30 / 60.0 AS "availableHours",
           COALESCE(sum(extract(epoch FROM least(b."endsAt", now()) - greatest(b."startsAt", now() - interval '30 days')) / 3600), 0)::float8 AS "bookedHours"
      FROM "Facility" f
      LEFT JOIN b ON b."facilityId" = f.id AND b."startsAt" < now() AND b."endsAt" > now() - interval '30 days'
     WHERE f."clubId" = ${club.id} AND f."isActive"
     GROUP BY f.id
     ORDER BY f.name`);
  const available = facilities.reduce((n, f) => n + Number(f.availableHours), 0);
  const booked = facilities.reduce((n, f) => n + Math.min(Number(f.bookedHours), Number(f.availableHours)), 0);
  return { facilities, availableHours: available, bookedHours: booked, rate: available > 0 ? booked / available : null };
}

export type RevenueMonth = { month: string; rentals: number; coaching: number; memberships: number };

export async function getRevenueByMonth(club: ClubRef, months = 6) {
  return rows<RevenueMonth>(sql`
    WITH months AS (
      SELECT generate_series(
               date_trunc('month', now() AT TIME ZONE ${club.timezone}) - make_interval(months => ${months - 1}),
               date_trunc('month', now() AT TIME ZONE ${club.timezone}),
               interval '1 month') AS m
    ),
    since AS (SELECT min(m) AT TIME ZONE ${club.timezone} AS t FROM months),
    earned AS (
      SELECT date_trunc('month', pt."paidAt" AT TIME ZONE ${club.timezone}) AS m, pt.kind::text AS kind,
             sum(tr.amount - tr."reversedAmount") AS amount
        FROM "PaymentTransaction" pt
        JOIN "PaymentTransfer" tr ON tr."paymentId" = pt.id AND tr."recipientType" = 'CLUB' AND tr.status IN ('PENDING', 'PAID')
       WHERE pt."clubId" = ${club.id} AND pt.status = 'SUCCEEDED' AND pt.currency = ${club.currency}
         AND pt."paidAt" >= (SELECT t FROM since)
       GROUP BY 1, 2
      UNION ALL
      SELECT date_trunc('month', "paidAt" AT TIME ZONE ${club.timezone}), 'COURT_RENTAL', sum("priceAmount")
        FROM "FacilityBooking"
       WHERE "clubId" = ${club.id} AND "paymentMethod" = 'ON_SITE' AND status = 'CONFIRMED' AND currency = ${club.currency}
         AND "paidAt" >= (SELECT t FROM since)
       GROUP BY 1
      UNION ALL
      SELECT date_trunc('month', "paidAt" AT TIME ZONE ${club.timezone}), 'MEMBERSHIP', sum("priceAmount")
        FROM "MemberPass"
       WHERE "clubId" = ${club.id} AND "paymentMethod" = 'ON_SITE' AND currency = ${club.currency}
         AND "paidAt" >= (SELECT t FROM since)
       GROUP BY 1
    )
    SELECT to_char(months.m, 'YYYY-MM') AS month,
           COALESCE(sum(e.amount) FILTER (WHERE e.kind = 'COURT_RENTAL'), 0)::float8 AS rentals,
           COALESCE(sum(e.amount) FILTER (WHERE e.kind = 'SESSION'), 0)::float8 AS coaching,
           COALESCE(sum(e.amount) FILTER (WHERE e.kind = 'MEMBERSHIP'), 0)::float8 AS memberships
      FROM months LEFT JOIN earned e ON e.m = months.m
     GROUP BY months.m
     ORDER BY months.m`);
}

export async function getMemberStats(club: ClubRef) {
  const [stats] = await rows<{ members: number; newMembers: number; passHolders: number; unlimited: number; credit: number; expiringSoon: number }>(sql`
    WITH valid AS (
      SELECT "userId", "creditsTotal", "expiresAt" FROM "MemberPass"
       WHERE "clubId" = ${club.id} AND "cancelledAt" IS NULL AND "startsAt" <= now() AND "expiresAt" > now()
         AND ("creditsTotal" IS NULL OR "creditsUsed" < "creditsTotal")
    )
    SELECT
      (SELECT count(*)::int FROM "ClubMember" WHERE "clubId" = ${club.id} AND role = 'STUDENT' AND status = 'ACTIVE') AS members,
      (SELECT count(*)::int FROM "ClubMember" WHERE "clubId" = ${club.id} AND role = 'STUDENT' AND status = 'ACTIVE'
          AND "joinedAt" > now() - interval '30 days') AS "newMembers",
      (SELECT count(DISTINCT "userId")::int FROM valid) AS "passHolders",
      (SELECT count(*)::int FROM valid WHERE "creditsTotal" IS NULL) AS unlimited,
      (SELECT count(*)::int FROM valid WHERE "creditsTotal" IS NOT NULL) AS credit,
      (SELECT count(*)::int FROM valid WHERE "expiresAt" < now() + interval '7 days') AS "expiringSoon"`);
  return stats!;
}

export type HeatCell = { dow: number; hour: number; minutes: number };

/**
 * Occupancy by weekday and hour over the last 28 days (exactly four of each
 * weekday), in the club's time zone: booked facility-minutes per slot.
 */
export async function getOccupancyHeatmap(club: ClubRef) {
  const [cells, [hours]] = await Promise.all([
    rows<HeatCell>(sql`
      WITH b AS (${occupancy(club.id)}),
      w AS (
        SELECT greatest(b."startsAt", now() - interval '28 days') AS s, least(b."endsAt", now()) AS e
          FROM b JOIN "Facility" f ON f.id = b."facilityId" AND f."isActive"
         WHERE b."startsAt" < now() AND b."endsAt" > now() - interval '28 days'
      ),
      slots AS (
        SELECT w.s, w.e, h
          FROM w, generate_series(date_trunc('hour', w.s, ${club.timezone}), w.e - interval '1 millisecond', interval '1 hour') AS h
      )
      SELECT extract(isodow FROM h AT TIME ZONE ${club.timezone})::int AS dow,
             extract(hour FROM h AT TIME ZONE ${club.timezone})::int AS hour,
             sum(extract(epoch FROM least(e, h + interval '1 hour') - greatest(s, h)) / 60)::float8 AS minutes
        FROM slots
       GROUP BY 1, 2`),
    rows<{ facilities: number; fromHour: number | null; toHour: number | null }>(sql`
      SELECT count(*)::int AS facilities, floor(min("openMinute") / 60.0)::int AS "fromHour", ceil(max("closeMinute") / 60.0)::int AS "toHour"
        FROM "Facility" WHERE "clubId" = ${club.id} AND "isActive"`),
  ]);
  // Columns span the facilities' opening hours (08:00–23:00 → 15 columns).
  return { cells, facilities: hours?.facilities ?? 0, fromHour: hours?.fromHour ?? 7, toHour: hours?.toHour ?? 23 };
}
