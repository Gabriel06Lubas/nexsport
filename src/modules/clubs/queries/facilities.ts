import "server-only";

import { and, asc, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { equipment, equipmentMaintenance, facility, facilityPriceRule, user } from "@/db/schema";

import { rows } from "./shared";

export async function listFacilities(clubId: string) {
  const [facilities, rules, upcoming] = await Promise.all([
    db.select().from(facility).where(eq(facility.clubId, clubId)).orderBy(desc(facility.isActive), asc(facility.name)),
    db
      .select()
      .from(facilityPriceRule)
      .where(eq(facilityPriceRule.clubId, clubId))
      .orderBy(asc(facilityPriceRule.dayOfWeek), asc(facilityPriceRule.startMinute)),
    rows<{ facilityId: string; n: number }>(sql`
      SELECT "facilityId", count(*)::int AS n FROM (
        SELECT "facilityId" FROM "PracticeSession" WHERE "clubId" = ${clubId} AND status <> 'CANCELLED' AND "endsAt" > now()
        UNION ALL
        SELECT "facilityId" FROM "FacilityBooking" WHERE "clubId" = ${clubId} AND status <> 'CANCELLED' AND "endsAt" > now()
      ) b GROUP BY 1`),
  ]);
  const upcomingBy = new Map(upcoming.map((u) => [u.facilityId, u.n]));
  return facilities.map((f) => ({ ...f, rules: rules.filter((r) => r.facilityId === f.id), upcomingBookings: upcomingBy.get(f.id) ?? 0 }));
}

export type FacilityRow = Awaited<ReturnType<typeof listFacilities>>[number];

export async function listEquipment(clubId: string) {
  return rows<{
    id: string;
    name: string;
    category: string | null;
    quantity: number;
    condition: "NEW" | "GOOD" | "FAIR" | "NEEDS_REPAIR" | "RETIRED";
    isActive: boolean;
    notes: string | null;
    inRepair: number;
    reservedUpcoming: number;
  }>(sql`
    SELECT e.id, e.name, e.category, e.quantity, e.condition, e."isActive", e.notes,
           COALESCE((SELECT sum(m.quantity) FROM "EquipmentMaintenance" m WHERE m."equipmentId" = e.id AND m."resolvedAt" IS NULL), 0)::int AS "inRepair",
           COALESCE((SELECT max(b.quantity) FROM "EquipmentBooking" b
                      WHERE b."equipmentId" = e.id AND b.status IN ('RESERVED', 'CHECKED_OUT') AND b."endsAt" > now()), 0)::int AS "reservedUpcoming"
      FROM "Equipment" e
     WHERE e."clubId" = ${clubId}
     ORDER BY e."isActive" DESC, e.category NULLS LAST, e.name`);
}

export async function listMaintenance(clubId: string) {
  const query = () =>
    db
      .select({
        id: equipmentMaintenance.id,
        equipmentName: equipment.name,
        quantity: equipmentMaintenance.quantity,
        reason: equipmentMaintenance.reason,
        startedAt: equipmentMaintenance.startedAt,
        resolvedAt: equipmentMaintenance.resolvedAt,
        resolutionNotes: equipmentMaintenance.resolutionNotes,
        reportedBy: user.name,
      })
      .from(equipmentMaintenance)
      .innerJoin(equipment, eq(equipment.id, equipmentMaintenance.equipmentId))
      .leftJoin(user, eq(user.id, equipmentMaintenance.reportedById));
  const [open, recent] = await Promise.all([
    query()
      .where(and(eq(equipmentMaintenance.clubId, clubId), isNull(equipmentMaintenance.resolvedAt)))
      .orderBy(asc(equipmentMaintenance.startedAt)),
    query()
      .where(and(eq(equipmentMaintenance.clubId, clubId), isNotNull(equipmentMaintenance.resolvedAt)))
      .orderBy(desc(equipmentMaintenance.resolvedAt))
      .limit(10),
  ]);
  return { open, recent };
}
