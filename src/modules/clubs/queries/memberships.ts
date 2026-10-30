import "server-only";

import { sql } from "drizzle-orm";

import { escapeLike, PAGE_SIZE } from "@/lib/list-params";

import { rows } from "./shared";

export async function listPlans(clubId: string) {
  return rows<{
    id: string;
    name: string;
    description: string | null;
    kind: "UNLIMITED" | "CREDITS";
    priceAmount: number;
    currency: string;
    durationDays: number;
    creditCount: number | null;
    isActive: boolean;
    activePasses: number;
    sold: number;
  }>(sql`
    SELECT p.id, p.name, p.description, p.kind, p."priceAmount", p.currency, p."durationDays", p."creditCount", p."isActive",
           count(mp.id) FILTER (WHERE mp."cancelledAt" IS NULL AND mp."startsAt" <= now() AND mp."expiresAt" > now()
                                  AND (mp."creditsTotal" IS NULL OR mp."creditsUsed" < mp."creditsTotal"))::int AS "activePasses",
           count(mp.id)::int AS sold
      FROM "MembershipPlan" p LEFT JOIN "MemberPass" mp ON mp."planId" = p.id
     WHERE p."clubId" = ${clubId}
     GROUP BY p.id
     ORDER BY p."isActive" DESC, p."priceAmount"`);
}

export const PASS_FILTERS = ["active", "expiring", "ended", "all"] as const;
export type PassFilter = (typeof PASS_FILTERS)[number];

export type PassRow = {
  id: string;
  planName: string;
  holderName: string | null;
  holderEmail: string;
  creditsTotal: number | null;
  creditsUsed: number;
  startsAt: Date;
  expiresAt: Date;
  cancelledAt: Date | null;
  priceAmount: number;
  currency: string;
  paymentMethod: "ONLINE" | "ON_SITE" | "COMPLIMENTARY";
};

/** A pass is valid when it has started, hasn't expired or been cancelled, and has credits left. */
const VALID = sql`mp."cancelledAt" IS NULL AND mp."startsAt" <= now() AND mp."expiresAt" > now() AND (mp."creditsTotal" IS NULL OR mp."creditsUsed" < mp."creditsTotal")`;

export async function listPasses(clubId: string, { filter, q, page }: { filter: PassFilter; q: string; page: number }) {
  const where = sql.join(
    [
      sql`mp."clubId" = ${clubId}`,
      filter === "active"
        ? sql`(${VALID} OR (mp."cancelledAt" IS NULL AND mp."startsAt" > now()))`
        : filter === "expiring"
          ? sql`${VALID} AND (mp."expiresAt" < now() + interval '14 days' OR mp."creditsTotal" - mp."creditsUsed" <= 2)`
          : filter === "ended"
            ? sql`NOT (${VALID}) AND NOT (mp."cancelledAt" IS NULL AND mp."startsAt" > now())`
            : sql`true`,
      q ? sql`(u.email ILIKE ${`%${escapeLike(q)}%`} ESCAPE '\\' OR u.name ILIKE ${`%${escapeLike(q)}%`} ESCAPE '\\')` : sql`true`,
    ],
    sql` AND `,
  );
  const [passes, [{ total = 0 } = {}]] = await Promise.all([
    rows<PassRow>(sql`
      SELECT mp.id, p.name AS "planName", u.name AS "holderName", u.email AS "holderEmail", mp."creditsTotal", mp."creditsUsed",
             mp."startsAt", mp."expiresAt", mp."cancelledAt", mp."priceAmount", mp.currency, mp."paymentMethod"
        FROM "MemberPass" mp JOIN "MembershipPlan" p ON p.id = mp."planId" JOIN "User" u ON u.id = mp."userId"
       WHERE ${where}
       ORDER BY mp."expiresAt" ASC, mp.id
       LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`),
    rows<{ total: number }>(sql`
      SELECT count(*)::int AS total
        FROM "MemberPass" mp JOIN "User" u ON u.id = mp."userId"
       WHERE ${where}`),
  ]);
  return { passes, total };
}
