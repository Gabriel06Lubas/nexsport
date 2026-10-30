import "server-only";

import { sql } from "drizzle-orm";

import { rows } from "./shared";

export type ScheduleItem = {
  kind: "session" | "rental";
  id: string;
  facilityId: string;
  startsAt: Date;
  endsAt: Date;
  title: string;
  status: string;
  priceAmount: number;
  currency: string;
  paymentMethod: "ONLINE" | "ON_SITE" | "COMPLIMENTARY" | null;
  paidAt: Date | null;
  detail: string | null;
};

/** Sessions and rentals overlapping [from, to), with who / what for each. */
export async function getSchedule(clubId: string, from: Date, to: Date) {
  const items = await rows<ScheduleItem>(sql`
    SELECT 'session' AS kind, s.id, s."facilityId", s."startsAt", s."endsAt", s.title, s.status::text,
           s."priceAmount", s.currency, NULL AS "paymentMethod", NULL::timestamptz AS "paidAt",
           COALESCE(u.name, u.email) AS detail
      FROM "PracticeSession" s JOIN "User" u ON u.id = s."coachId"
     WHERE s."clubId" = ${clubId} AND s."startsAt" < ${to} AND s."endsAt" > ${from}
    UNION ALL
    SELECT 'rental', b.id, b."facilityId", b."startsAt", b."endsAt", COALESCE(b."customerName", u.name, u.email, 'Customer'), b.status::text,
           b."priceAmount", b.currency, b."paymentMethod"::text, b."paidAt", u.email
      FROM "FacilityBooking" b LEFT JOIN "User" u ON u.id = b."customerId"
     WHERE b."clubId" = ${clubId} AND b."startsAt" < ${to} AND b."endsAt" > ${from}
     ORDER BY 4`);
  return items.map((i) => ({ ...i, startsAt: new Date(i.startsAt), endsAt: new Date(i.endsAt), paidAt: i.paidAt ? new Date(i.paidAt) : null }));
}
