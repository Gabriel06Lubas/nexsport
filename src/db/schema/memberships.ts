import { sql } from "drizzle-orm";
import { boolean, char, check, integer, pgTable, text, unique } from "drizzle-orm/pg-core";

import { createdAt, fk, id, idx, tstz, uniq, updatedAt } from "../columns";
import { user } from "./auth";
import { club } from "./clubs";
import { membershipPlanKind, paymentMethod } from "./enums";

// =============================================================================
// MEMBERSHIPS & CREDIT PASSES
// =============================================================================

/** What a club sells: "Monthly Unlimited" (UNLIMITED) or "10-Session Pass" (CREDITS). */
export const membershipPlan = pgTable(
  "MembershipPlan",
  {
    id: id(),
    clubId: text().notNull(),
    name: text().notNull(),
    description: text(),
    kind: membershipPlanKind().notNull(),
    /** Minor units. */
    priceAmount: integer().notNull(),
    currency: char({ length: 3 }).notNull().default("eur"),
    /** How long a pass stays valid after it starts. */
    durationDays: integer().notNull(),
    /** CREDITS plans only: sessions included. */
    creditCount: integer(),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniq("MembershipPlan", t.clubId, t.name),
    unique("MembershipPlan_id_clubId_key").on(t.id, t.clubId),
    fk("MembershipPlan", [t.clubId], [club.id]).onDelete("cascade"),
    check("MembershipPlan_price_non_negative", sql`"priceAmount" >= 0`),
    check("MembershipPlan_currency_format", sql`"currency" ~ '^[a-z]{3}$'`),
    check("MembershipPlan_duration", sql`"durationDays" BETWEEN 1 AND 3660`),
    check(
      "MembershipPlan_credits_match_kind",
      sql`("kind" = 'CREDITS' AND "creditCount" IS NOT NULL AND "creditCount" BETWEEN 1 AND 1000) OR ("kind" = 'UNLIMITED' AND "creditCount" IS NULL)`,
    ),
  ],
);

/**
 * One member's pass, sold from a plan. Terms are copied from the plan at
 * sale time, so editing a plan never changes passes already sold.
 */
export const memberPass = pgTable(
  "MemberPass",
  {
    id: id(),
    clubId: text().notNull(),
    planId: text().notNull(),
    userId: text().notNull(),
    /** Snapshot of the plan's credits; null = unlimited. */
    creditsTotal: integer(),
    creditsUsed: integer().notNull().default(0),
    startsAt: tstz().notNull(),
    expiresAt: tstz().notNull(),
    priceAmount: integer().notNull(),
    currency: char({ length: 3 }).notNull(),
    paymentMethod: paymentMethod().notNull(),
    paidAt: tstz(),
    soldById: text(),
    cancelledAt: tstz(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("MemberPass_id_clubId_key").on(t.id, t.clubId),
    idx("MemberPass", t.clubId, t.expiresAt),
    idx("MemberPass", t.userId),
    fk("MemberPass", [t.clubId], [club.id]).onDelete("cascade"),
    fk("MemberPass", [t.planId, t.clubId], [membershipPlan.id, membershipPlan.clubId]).onDelete("restrict"),
    fk("MemberPass", [t.userId], [user.id]).onDelete("cascade"),
    fk("MemberPass", [t.soldById], [user.id]).onDelete("set null"),
    check("MemberPass_credits", sql`"creditsUsed" >= 0 AND ("creditsTotal" IS NULL OR ("creditsTotal" > 0 AND "creditsUsed" <= "creditsTotal"))`),
    check("MemberPass_period_order", sql`"expiresAt" > "startsAt"`),
    check("MemberPass_price_non_negative", sql`"priceAmount" >= 0`),
    check("MemberPass_currency_format", sql`"currency" ~ '^[a-z]{3}$'`),
  ],
);
