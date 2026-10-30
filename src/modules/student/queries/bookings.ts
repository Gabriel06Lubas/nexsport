import "server-only";

import { sql } from "drizzle-orm";

import { PAGE_SIZE } from "@/lib/list-params";
import { rows } from "@/modules/clubs/queries/shared";

// A student's bookings: seats in sessions (private, group, open match) and
// court rentals booked in their name, with the payment that goes with each.
//
// Status shown to the student:
//   * Confirmed: in the session / rental, nothing outstanding;
//   * Pending: a seat held while an online payment is open, or an invitation;
//   * Cancelled: by the student, the coach or the club.

export type MyBooking = {
  kind: "session" | "rental";
  id: string;
  participantId: string | null;
  sessionKind: "PRIVATE" | "GROUP" | "OPEN_MATCH" | null;
  title: string;
  startsAt: Date;
  endsAt: Date;
  clubId: string;
  clubName: string;
  address: string | null;
  city: string | null;
  country: string;
  timezone: string;
  facilityName: string;
  coachName: string | null;
  status: "CONFIRMED" | "PENDING" | "CANCELLED";
  cancelledByMe: boolean;
  priceAmount: number;
  currency: string;
  policyId: string | null;
  paymentId: string | null;
  paymentStatus: string | null;
  paymentAmount: number | null;
  checkoutUrl: string | null;
  checkoutExpiresAt: Date | null;
  refundStatus: string | null;
  refundedAmount: number | null;
  appliedRefundPercent: number | null;
  rentalPayment: "ONLINE" | "ON_SITE" | "COMPLIMENTARY" | null;
  paidAt: Date | null;
};

export type BookingScope = "upcoming" | "past" | "cancelled" | "all";

const mine = (userId: string) => sql`
  SELECT 'session' AS kind, s.id, p.id AS "participantId", s.kind AS "sessionKind", s.title, s."startsAt", s."endsAt",
         c.id AS "clubId", c.name AS "clubName", concat_ws(', ', c."addressLine1", c."postalCode") AS address, c.city, c.country, c.timezone,
         f.name AS "facilityName", COALESCE(co.name, co.email) AS "coachName",
         CASE WHEN s.status = 'CANCELLED' OR p.status IN ('CANCELLED', 'REMOVED', 'DECLINED') THEN 'CANCELLED'
              WHEN pt.status = 'REQUIRES_PAYMENT_METHOD' OR p.status IN ('INVITED', 'WAITLISTED') THEN 'PENDING'
              ELSE 'CONFIRMED' END AS status,
         (p.status = 'CANCELLED' AND s.status <> 'CANCELLED') AS "cancelledByMe",
         s."priceAmount", s.currency, s."cancellationPolicyId" AS "policyId",
         pt.id AS "paymentId", pt.status::text AS "paymentStatus", pt.amount AS "paymentAmount", pt."checkoutUrl", pt."checkoutExpiresAt",
         pt."refundStatus"::text AS "refundStatus", pt."refundedAmount", pt."appliedRefundPercent", NULL AS "rentalPayment", pt."paidAt"
    FROM "SessionParticipant" p
    JOIN "PracticeSession" s ON s.id = p."sessionId"
    JOIN "Club" c ON c.id = s."clubId"
    JOIN "Facility" f ON f.id = s."facilityId"
    JOIN "User" co ON co.id = s."coachId"
    LEFT JOIN LATERAL (
      SELECT * FROM "PaymentTransaction" x WHERE x."participantId" = p.id ORDER BY x."createdAt" DESC LIMIT 1
    ) pt ON true
   WHERE p."userId" = ${userId}
  UNION ALL
  SELECT 'rental', b.id, NULL, NULL, 'Court rental', b."startsAt", b."endsAt",
         c.id, c.name, concat_ws(', ', c."addressLine1", c."postalCode"), c.city, c.country, c.timezone,
         f.name, NULL,
         CASE WHEN b.status = 'CANCELLED' THEN 'CANCELLED' ELSE 'CONFIRMED' END,
         (b.status = 'CANCELLED' AND b."cancelledById" = ${userId}),
         b."priceAmount", b.currency, NULL,
         pt.id, pt.status::text, pt.amount, NULL, NULL,
         pt."refundStatus"::text, pt."refundedAmount", pt."appliedRefundPercent", b."paymentMethod"::text, COALESCE(pt."paidAt", b."paidAt")
    FROM "FacilityBooking" b
    JOIN "Club" c ON c.id = b."clubId"
    JOIN "Facility" f ON f.id = b."facilityId"
    LEFT JOIN LATERAL (
      SELECT * FROM "PaymentTransaction" x WHERE x."facilityBookingId" = b.id ORDER BY x."createdAt" DESC LIMIT 1
    ) pt ON true
   WHERE b."customerId" = ${userId}`;

const scopeFilter = (scope: BookingScope) =>
  scope === "upcoming"
    ? sql`b."endsAt" > now() AND b.status <> 'CANCELLED'`
    : scope === "past"
      ? sql`b."endsAt" <= now() AND b.status <> 'CANCELLED'`
      : scope === "cancelled"
        ? sql`b.status = 'CANCELLED'`
        : sql`true`;

const hydrate = (list: MyBooking[]) =>
  list.map((b) => ({
    ...b,
    startsAt: new Date(b.startsAt),
    endsAt: new Date(b.endsAt),
    checkoutExpiresAt: b.checkoutExpiresAt ? new Date(b.checkoutExpiresAt) : null,
    paidAt: b.paidAt ? new Date(b.paidAt) : null,
  }));

export async function listMyBookings(userId: string, { scope, page }: { scope: BookingScope; page: number }) {
  const order = scope === "upcoming" ? sql`b."startsAt" ASC` : sql`b."startsAt" DESC`;
  const [list, [{ total = 0 } = {}]] = await Promise.all([
    rows<MyBooking>(sql`SELECT * FROM (${mine(userId)}) b WHERE ${scopeFilter(scope)} ORDER BY ${order}, b.id LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`),
    rows<{ total: number }>(sql`SELECT count(*)::int AS total FROM (${mine(userId)}) b WHERE ${scopeFilter(scope)}`),
  ]);
  return { list: hydrate(list), total };
}

/** The schedule feed: upcoming bookings, plus cancellations of upcoming ones (so they're noticed). */
export async function getMyFeed(userId: string, days = 30) {
  const list = await rows<MyBooking>(sql`
    SELECT * FROM (${mine(userId)}) b
     WHERE b."endsAt" > now() AND b."startsAt" < now() + make_interval(days => ${days})
     ORDER BY b."startsAt", b.id
     LIMIT 60`);
  return hydrate(list);
}

/** One of the student's own bookings (for actions): null if it isn't theirs. */
export async function getMyBooking(userId: string, kind: "session" | "rental", id: string) {
  const [b] = await rows<MyBooking>(sql`SELECT * FROM (${mine(userId)}) b WHERE b.kind = ${kind} AND b.id = ${id} LIMIT 1`);
  return b ? hydrate([b])[0]! : null;
}

export type MyPass = {
  id: string;
  planName: string;
  kind: "UNLIMITED" | "CREDITS";
  clubName: string;
  creditsTotal: number | null;
  creditsUsed: number;
  startsAt: Date;
  expiresAt: Date;
  cancelledAt: Date | null;
  priceAmount: number;
  currency: string;
  paymentMethod: string;
  paidAt: Date | null;
  createdAt: Date;
};

export async function listMyPasses(userId: string) {
  const list = await rows<MyPass>(sql`
    SELECT mp.id, pl.name AS "planName", pl.kind, c.name AS "clubName", mp."creditsTotal", mp."creditsUsed", mp."startsAt", mp."expiresAt",
           mp."cancelledAt", mp."priceAmount", mp.currency, mp."paymentMethod", mp."paidAt", mp."createdAt"
      FROM "MemberPass" mp JOIN "MembershipPlan" pl ON pl.id = mp."planId" JOIN "Club" c ON c.id = mp."clubId"
     WHERE mp."userId" = ${userId}
     ORDER BY (mp."cancelledAt" IS NULL AND mp."expiresAt" > now()) DESC, mp."expiresAt" DESC`);
  return list.map((p) => ({ ...p, startsAt: new Date(p.startsAt), expiresAt: new Date(p.expiresAt), cancelledAt: p.cancelledAt ? new Date(p.cancelledAt) : null, paidAt: p.paidAt ? new Date(p.paidAt) : null, createdAt: new Date(p.createdAt) }));
}

export const isPassValid = (p: Pick<MyPass, "cancelledAt" | "startsAt" | "expiresAt" | "creditsTotal" | "creditsUsed">, now = Date.now()) =>
  !p.cancelledAt && p.startsAt.getTime() <= now && p.expiresAt.getTime() > now && (p.creditsTotal === null || p.creditsUsed < p.creditsTotal);

export async function listMyCreditHistory(userId: string) {
  const list = await rows<{ id: string; delta: number; reason: string; createdAt: Date; planName: string; actor: string | null }>(sql`
    SELECT adj.id, adj.delta, adj.reason, adj."createdAt", pl.name AS "planName", COALESCE(a.name, a.email) AS actor
      FROM "PassCreditAdjustment" adj
      JOIN "MemberPass" mp ON mp.id = adj."passId"
      JOIN "MembershipPlan" pl ON pl.id = mp."planId"
      LEFT JOIN "User" a ON a.id = adj."actorId"
     WHERE mp."userId" = ${userId}
     ORDER BY adj."createdAt" DESC
     LIMIT 20`);
  return list.map((a) => ({ ...a, createdAt: new Date(a.createdAt) }));
}

export async function listMyClubs(userId: string) {
  return rows<{ id: string; name: string; city: string | null; joinedAt: Date | null }>(sql`
    SELECT c.id, c.name, c.city, m."joinedAt" FROM "ClubMember" m JOIN "Club" c ON c.id = m."clubId"
     WHERE m."userId" = ${userId} AND m.role = 'STUDENT' AND m.status = 'ACTIVE' AND c."deletedAt" IS NULL
     ORDER BY c.name`);
}

export async function listMyPayments(userId: string, page: number) {
  const [list, [{ total = 0 } = {}]] = await Promise.all([
    rows<{ id: string; kind: string; description: string; amount: number; currency: string; status: string; refundStatus: string; refundedAmount: number; paidAt: Date | null; createdAt: Date }>(sql`
      SELECT pt.id, pt.kind, pt.amount, pt.currency, pt.status, pt."refundStatus", pt."refundedAmount", pt."paidAt", pt."createdAt",
             CASE pt.kind WHEN 'SESSION' THEN s.title WHEN 'COURT_RENTAL' THEN 'Court rental · ' || f.name ELSE 'Pass · ' || pl.name END || ' · ' || c.name AS description
        FROM "PaymentTransaction" pt
        JOIN "Club" c ON c.id = pt."clubId"
        LEFT JOIN "PracticeSession" s ON s.id = pt."sessionId"
        LEFT JOIN "FacilityBooking" fb ON fb.id = pt."facilityBookingId"
        LEFT JOIN "Facility" f ON f.id = fb."facilityId"
        LEFT JOIN "MemberPass" mp ON mp.id = pt."memberPassId"
        LEFT JOIN "MembershipPlan" pl ON pl.id = mp."planId"
       WHERE pt."payerId" = ${userId} AND pt.status <> 'REQUIRES_PAYMENT_METHOD'
       ORDER BY COALESCE(pt."paidAt", pt."createdAt") DESC, pt.id
       LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`),
    rows<{ total: number }>(sql`SELECT count(*)::int AS total FROM "PaymentTransaction" WHERE "payerId" = ${userId} AND status <> 'REQUIRES_PAYMENT_METHOD'`),
  ]);
  return { list, total };
}
