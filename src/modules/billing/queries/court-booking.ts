import "server-only";

import { sql } from "drizzle-orm";

import { rows } from "@/modules/clubs/queries/shared";

/**
 * Facilities customers can book and pay online: active facilities at active
 * clubs whose Stripe Connect account can take charges and receive payouts
 * (a destination charge to an account that can't would fail).
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
      JOIN "Club" c ON c.id = f."clubId" AND c."deletedAt" IS NULL AND c.status = 'ACTIVE'
      JOIN "StripeAccount" sa ON sa."clubId" = c.id AND sa."chargesEnabled" AND sa."payoutsEnabled"
     WHERE f."isActive"
     ORDER BY c.name, f.name`);
}
