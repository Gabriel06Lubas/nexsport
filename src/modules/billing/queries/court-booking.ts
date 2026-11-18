import "server-only";

import { and, eq, gt, inArray, lt, ne, sql } from "drizzle-orm";

import { db } from "@/db";
import { club, facilityBooking, facilityPriceRule, practiceSession } from "@/db/schema";
import { clubOpenToPublicSql } from "@/lib/entitlements";
import { addDays, zonedToUtc } from "@/modules/clubs/lib/zoned-time";
import { rows } from "@/modules/clubs/queries/shared";

/**
 * Facilities customers can book and pay online: active facilities at active
 * clubs whose Stripe Connect account can take charges and receive payouts
 * (a destination charge to an account that can't would fail), at clubs
 * open to the public (clubOpenToPublicSql: not deleted or suspended, with
 * a live subscription).
 */
export async function listBookableFacilities() {
  return rows<{
    facilityId: string;
    facilityName: string;
    clubId: string;
    clubName: string;
    city: string | null;
    timezone: string;
    currency: string;
    openMinute: number;
    closeMinute: number;
    rate: number | null;
  }>(sql`
    SELECT f.id AS "facilityId", f.name AS "facilityName", c.id AS "clubId", c.name AS "clubName", c.city, c.timezone, c.currency,
           f."openMinute", f."closeMinute", f."hourlyRateAmount" AS rate
      FROM "Facility" f
      JOIN "Club" c ON c.id = f."clubId"
      JOIN "StripeAccount" sa ON sa."clubId" = c.id AND sa."chargesEnabled" AND sa."payoutsEnabled"
     WHERE f."isActive" AND ${clubOpenToPublicSql(sql`c`)}
     ORDER BY c.name, f.name`);
}

/** Clubs with at least one court bookable online, for the club picker. */
export async function listBookableClubs() {
  const facilities = await listBookableFacilities();
  const clubs = new Map<string, { clubId: string; clubName: string; city: string | null; timezone: string }>();
  for (const f of facilities) if (!clubs.has(f.clubId)) clubs.set(f.clubId, { clubId: f.clubId, clubName: f.clubName, city: f.city, timezone: f.timezone });
  return [...clubs.values()];
}

/**
 * What the availability grid needs for one club and one local date: its
 * bookable courts (same rule as listBookableFacilities) with their price
 * rules, and everything occupying them that day: rentals that aren't
 * cancelled (PENDING holds block a court like confirmed ones) and coached
 * sessions. Null when the club doesn't take online bookings.
 */
export async function getCourtGridData(clubId: string, date: string) {
  const courts = (await listBookableFacilities()).filter((f) => f.clubId === clubId);
  const first = courts[0];
  if (!first) return null;
  const [clubRow] = await db.select({ country: club.country }).from(club).where(eq(club.id, clubId));
  const dayStart = zonedToUtc(date, 0, first.timezone);
  const dayEnd = zonedToUtc(addDays(date, 1), 0, first.timezone);
  if (!dayStart || !dayEnd || !clubRow) return null;

  const ids = courts.map((c) => c.facilityId);
  const [rules, rentals, sessions] = await Promise.all([
    db
      .select({ facilityId: facilityPriceRule.facilityId, dayOfWeek: facilityPriceRule.dayOfWeek, startMinute: facilityPriceRule.startMinute, endMinute: facilityPriceRule.endMinute, tier: facilityPriceRule.tier, hourlyRateAmount: facilityPriceRule.hourlyRateAmount })
      .from(facilityPriceRule)
      .where(inArray(facilityPriceRule.facilityId, ids)),
    db
      .select({ facilityId: facilityBooking.facilityId, startsAt: facilityBooking.startsAt, endsAt: facilityBooking.endsAt })
      .from(facilityBooking)
      .where(and(inArray(facilityBooking.facilityId, ids), ne(facilityBooking.status, "CANCELLED"), lt(facilityBooking.startsAt, dayEnd), gt(facilityBooking.endsAt, dayStart))),
    db
      .select({ facilityId: practiceSession.facilityId, startsAt: practiceSession.startsAt, endsAt: practiceSession.endsAt })
      .from(practiceSession)
      .where(and(inArray(practiceSession.facilityId, ids), ne(practiceSession.status, "CANCELLED"), lt(practiceSession.startsAt, dayEnd), gt(practiceSession.endsAt, dayStart))),
  ]);

  return {
    club: { id: clubId, name: first.clubName, timezone: first.timezone, currency: first.currency, country: clubRow.country },
    courts: courts.map((c) => ({
      id: c.facilityId,
      name: c.facilityName,
      openMinute: c.openMinute,
      closeMinute: c.closeMinute,
      rate: c.rate,
      rules: rules.filter((r) => r.facilityId === c.facilityId),
    })),
    busy: [...rentals, ...sessions].filter((b): b is { facilityId: string; startsAt: Date; endsAt: Date } => b.facilityId !== null),
  };
}
