import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { adminAuditLog, stripeWebhookEvent, subscriptionPlan } from "@/db/schema";

import { escapeLike, PAGE_SIZE } from "@/lib/list-params";

// Read models for the admin dashboard. Every value that comes from the URL or
// a form is passed as a bound parameter (Drizzle's sql`` template turns each
// ${value} into $1, $2, …); nothing is concatenated into SQL text.
//
// Definitions used throughout:
//   * Tenant: a club (not deleted) or an independent coach (a user with role
//     COACH, not deleted). Coaches without a paid plan are on FREE_COACH.
//   * Live subscription: status other than CANCELED / INCOMPLETE_EXPIRED.
//   * MRR: sum of Subscription.monthlyAmount for ACTIVE and PAST_DUE
//     subscriptions (trials aren't paying yet), per currency.
//   * Volume: amount of SUCCEEDED payments, before refunds, per currency.

export type MoneyTotal = { currency: string; amount: number };

const LIVE_SUB = sql`s.status NOT IN ('CANCELED', 'INCOMPLETE_EXPIRED')`;

async function rows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  return (await db.execute(query)).rows as T[];
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export async function getOverview() {
  const [mrr, tenants, connect, volume, volume30] = await Promise.all([
    rows<MoneyTotal & { subscriptions: number }>(sql`
      SELECT currency, sum("monthlyAmount")::int AS amount, count(*)::int AS subscriptions
      FROM "Subscription" WHERE status IN ('ACTIVE', 'PAST_DUE')
      GROUP BY currency ORDER BY amount DESC`),
    rows<{ clubs: number; clubsSuspended: number; coaches: number; coachesSuspended: number; proCoaches: number }>(sql`
      SELECT
        (SELECT count(*)::int FROM "Club" WHERE "deletedAt" IS NULL AND status = 'ACTIVE') AS clubs,
        (SELECT count(*)::int FROM "Club" WHERE "deletedAt" IS NULL AND status = 'SUSPENDED') AS "clubsSuspended",
        (SELECT count(*)::int FROM "User" WHERE role = 'COACH' AND "deletedAt" IS NULL AND "suspendedAt" IS NULL) AS coaches,
        (SELECT count(*)::int FROM "User" WHERE role = 'COACH' AND "deletedAt" IS NULL AND "suspendedAt" IS NOT NULL) AS "coachesSuspended",
        (SELECT count(DISTINCT s."userId")::int FROM "Subscription" s
           WHERE s.tier = 'PRO_COACH' AND s.status IN ('ACTIVE', 'PAST_DUE', 'TRIALING')) AS "proCoaches"`),
    rows<{ total: number; healthy: number }>(sql`
      SELECT count(*)::int AS total, count(*) FILTER (WHERE "chargesEnabled" AND "payoutsEnabled")::int AS healthy
      FROM "StripeAccount"`),
    rows<MoneyTotal & { fees: number; payments: number }>(sql`
      SELECT currency, sum(amount)::bigint::float8 AS amount, sum("applicationFeeAmount")::bigint::float8 AS fees, count(*)::int AS payments
      FROM "PaymentTransaction" WHERE status = 'SUCCEEDED'
      GROUP BY currency ORDER BY amount DESC`),
    rows<MoneyTotal>(sql`
      SELECT currency, sum(amount)::bigint::float8 AS amount
      FROM "PaymentTransaction" WHERE status = 'SUCCEEDED' AND "paidAt" > now() - interval '30 days'
      GROUP BY currency ORDER BY amount DESC`),
  ]);
  return { mrr, tenants: tenants[0]!, connect: connect[0]!, volume, volume30 };
}

export type ActivityItem = {
  kind: "club_signup" | "coach_signup" | "subscription" | "dispute";
  id: string;
  title: string;
  detail: string | null;
  at: Date;
  href: string | null;
};

export async function getRecentActivity(limit = 12): Promise<ActivityItem[]> {
  const items = await rows<ActivityItem & { at: string | Date }>(sql`
    (SELECT 'club_signup' AS kind, c.id, c.name AS title, u.email AS detail, c."createdAt" AS at,
            '/admin/tenants/club/' || c.id AS href
       FROM "Club" c JOIN "User" u ON u.id = c."ownerId"
      WHERE c."deletedAt" IS NULL ORDER BY c."createdAt" DESC LIMIT ${limit})
    UNION ALL
    (SELECT 'coach_signup', u.id, coalesce(p."displayName", u.name, u.email), u.email, u."createdAt",
            '/admin/tenants/coach/' || u.id
       FROM "User" u LEFT JOIN "Profile" p ON p."userId" = u.id
      WHERE u.role = 'COACH' AND u."deletedAt" IS NULL ORDER BY u."createdAt" DESC LIMIT ${limit})
    UNION ALL
    (SELECT 'subscription', s.id, coalesce(c.name, cu.email, 'Unknown'), s.tier::text || ' · ' || lower(s.status::text), s."createdAt",
            CASE WHEN s."clubId" IS NOT NULL THEN '/admin/tenants/club/' || s."clubId" ELSE '/admin/tenants/coach/' || s."userId" END
       FROM "Subscription" s LEFT JOIN "Club" c ON c.id = s."clubId" LEFT JOIN "User" cu ON cu.id = s."userId"
      ORDER BY s."createdAt" DESC LIMIT ${limit})
    UNION ALL
    (SELECT 'dispute', pt.id, c.name, lower(replace(pt."disputeStatus"::text, '_', ' ')), pt."updatedAt", '/admin/financials'
       FROM "PaymentTransaction" pt JOIN "Club" c ON c.id = pt."clubId"
      WHERE pt."disputeStatus" <> 'NONE' ORDER BY pt."updatedAt" DESC LIMIT ${limit})
    ORDER BY at DESC LIMIT ${limit}`);
  return items.map((item) => ({ ...item, at: new Date(item.at) }));
}

// ---------------------------------------------------------------------------
// Tenants
// ---------------------------------------------------------------------------

export type TenantRow = {
  kind: "club" | "coach";
  id: string;
  name: string;
  ownerEmail: string;
  ownerId: string;
  status: string;
  tier: string | null;
  facilities: number | null;
  connectStatus: string | null;
  chargesEnabled: boolean | null;
  payoutsEnabled: boolean | null;
  createdAt: Date;
};

export async function listTenants({ q, type, page }: { q: string; type: "all" | "club" | "coach"; page: number }) {
  const pattern = `%${escapeLike(q)}%`;
  const result = await rows<TenantRow & { total: number; createdAt: string | Date }>(sql`
    SELECT t.*, count(*) OVER ()::int AS total FROM (
      SELECT 'club' AS kind, c.id, c.name, u.email AS "ownerEmail", u.id AS "ownerId", c.status::text AS status, c."createdAt",
             (SELECT s.tier::text FROM "Subscription" s WHERE s."clubId" = c.id AND ${LIVE_SUB}
               ORDER BY s."createdAt" DESC LIMIT 1) AS tier,
             (SELECT count(*)::int FROM "Facility" f WHERE f."clubId" = c.id AND f."isActive") AS facilities,
             sa.status::text AS "connectStatus", sa."chargesEnabled", sa."payoutsEnabled"
        FROM "Club" c
        JOIN "User" u ON u.id = c."ownerId"
        LEFT JOIN "StripeAccount" sa ON sa."clubId" = c.id
       WHERE c."deletedAt" IS NULL
      UNION ALL
      SELECT 'coach', u.id, coalesce(p."displayName", u.name, u.email), u.email, u.id,
             CASE WHEN u."suspendedAt" IS NOT NULL THEN 'SUSPENDED' ELSE 'ACTIVE' END, u."createdAt",
             coalesce((SELECT s.tier::text FROM "Subscription" s WHERE s."userId" = u.id AND ${LIVE_SUB}
                        ORDER BY s."createdAt" DESC LIMIT 1), 'FREE_COACH'),
             NULL::int,
             sa.status::text, sa."chargesEnabled", sa."payoutsEnabled"
        FROM "User" u
        LEFT JOIN "Profile" p ON p."userId" = u.id
        LEFT JOIN "StripeAccount" sa ON sa."userId" = u.id
       WHERE u.role = 'COACH' AND u."deletedAt" IS NULL
    ) t
    WHERE (${type} = 'all' OR t.kind = ${type})
      AND (${q} = '' OR t.name ILIKE ${pattern} ESCAPE '\\' OR t."ownerEmail" ILIKE ${pattern} ESCAPE '\\')
    ORDER BY t."createdAt" DESC, t.id
    LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`);
  return {
    total: result[0]?.total ?? 0,
    tenants: result.map(({ total: _total, ...row }) => ({ ...row, createdAt: new Date(row.createdAt) })) as TenantRow[],
  };
}

export async function getClubDetail(id: string) {
  const [club] = await rows<{
    id: string;
    name: string;
    slug: string;
    status: string;
    city: string | null;
    country: string;
    createdAt: string;
    ownerId: string;
    ownerEmail: string;
    ownerName: string | null;
    ownerRole: string;
  }>(sql`
    SELECT c.id, c.name, c.slug, c.status::text AS status, c.city, c.country, c."createdAt",
           u.id AS "ownerId", u.email AS "ownerEmail", u.name AS "ownerName", u.role::text AS "ownerRole"
      FROM "Club" c JOIN "User" u ON u.id = c."ownerId"
     WHERE c.id = ${id} AND c."deletedAt" IS NULL`);
  if (!club) return null;
  const [subscription, account, counts, payments, audit] = await Promise.all([
    tenantSubscription(sql`s."clubId" = ${id}`),
    tenantConnect(sql`"clubId" = ${id}`),
    rows<{ members: number; coaches: number; facilities: number; sessions30: number }>(sql`
      SELECT (SELECT count(*)::int FROM "ClubMember" WHERE "clubId" = ${id} AND role = 'STUDENT' AND status = 'ACTIVE') AS members,
             (SELECT count(*)::int FROM "ClubMember" WHERE "clubId" = ${id} AND role IN ('COACH', 'STAFF') AND status = 'ACTIVE') AS coaches,
             (SELECT count(*)::int FROM "Facility" WHERE "clubId" = ${id} AND "isActive") AS facilities,
             (SELECT count(*)::int FROM "PracticeSession" WHERE "clubId" = ${id} AND "startsAt" > now() - interval '30 days') AS "sessions30"`),
    recentPayments(sql`pt."clubId" = ${id}`),
    auditFor("club", id),
  ]);
  return { club: { ...club, createdAt: new Date(club.createdAt) }, subscription, account, counts: counts[0]!, payments, audit };
}

export async function getCoachDetail(id: string) {
  const [coach] = await rows<{
    id: string;
    name: string;
    email: string;
    handle: string | null;
    suspendedAt: string | null;
    suspensionReason: string | null;
    createdAt: string;
    emailVerified: string | null;
  }>(sql`
    SELECT u.id, coalesce(p."displayName", u.name, u.email) AS name, u.email, p.handle, u."suspendedAt", u."suspensionReason",
           u."createdAt", u."emailVerified"
      FROM "User" u LEFT JOIN "Profile" p ON p."userId" = u.id
     WHERE u.id = ${id} AND u.role = 'COACH' AND u."deletedAt" IS NULL`);
  if (!coach) return null;
  const [subscription, account, counts, payments, audit] = await Promise.all([
    tenantSubscription(sql`s."userId" = ${id}`),
    tenantConnect(sql`"userId" = ${id}`),
    rows<{ clubs: number; sessions30: number; sessionsTotal: number }>(sql`
      SELECT (SELECT count(DISTINCT "clubId")::int FROM "ClubMember" WHERE "userId" = ${id} AND status = 'ACTIVE') AS clubs,
             (SELECT count(*)::int FROM "PracticeSession" WHERE "coachId" = ${id} AND "startsAt" > now() - interval '30 days') AS "sessions30",
             (SELECT count(*)::int FROM "PracticeSession" WHERE "coachId" = ${id}) AS "sessionsTotal"`),
    recentPayments(sql`pt."coachId" = ${id}`),
    auditFor("coach", id),
  ]);
  return { coach: { ...coach, createdAt: new Date(coach.createdAt) }, subscription, account, counts: counts[0]!, payments, audit };
}

async function tenantSubscription(where: ReturnType<typeof sql>) {
  const [row] = await rows<{
    tier: string;
    status: string;
    monthlyAmount: number;
    currency: string;
    currentPeriodEnd: string;
    cancelAtPeriodEnd: boolean;
  }>(sql`
    SELECT s.tier::text AS tier, s.status::text AS status, s."monthlyAmount", s.currency, s."currentPeriodEnd", s."cancelAtPeriodEnd"
      FROM "Subscription" s WHERE ${where} AND ${LIVE_SUB} ORDER BY s."createdAt" DESC LIMIT 1`);
  return row ?? null;
}

async function tenantConnect(where: ReturnType<typeof sql>) {
  const [row] = await rows<{
    stripeAccountId: string;
    status: string;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    requirementsDue: string[];
    disabledReason: string | null;
  }>(sql`
    SELECT "stripeAccountId", status::text AS status, "chargesEnabled", "payoutsEnabled", "requirementsDue", "disabledReason"
      FROM "StripeAccount" WHERE ${where} LIMIT 1`);
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Payments & financials
// ---------------------------------------------------------------------------

export type PaymentRow = {
  id: string;
  clubName: string;
  amount: number;
  applicationFeeAmount: number;
  currency: string;
  status: string;
  refundStatus: string;
  disputeStatus: string;
  paidAt: string | null;
  createdAt: string;
  transfersPending: number;
  transfersFailed: number;
};

async function recentPayments(where: ReturnType<typeof sql>, limit = 10) {
  return rows<PaymentRow>(sql`
    SELECT pt.id, c.name AS "clubName", pt.amount, pt."applicationFeeAmount", pt.currency, pt.status::text AS status,
           pt."refundStatus"::text AS "refundStatus", pt."disputeStatus"::text AS "disputeStatus", pt."paidAt", pt."createdAt",
           (SELECT count(*)::int FROM "PaymentTransfer" tr WHERE tr."paymentId" = pt.id AND tr.status = 'PENDING') AS "transfersPending",
           (SELECT count(*)::int FROM "PaymentTransfer" tr WHERE tr."paymentId" = pt.id AND tr.status IN ('FAILED', 'REVERSED')) AS "transfersFailed"
      FROM "PaymentTransaction" pt JOIN "Club" c ON c.id = pt."clubId"
     WHERE ${where}
     ORDER BY pt."createdAt" DESC LIMIT ${limit}`);
}

export async function getFinancials() {
  const [fees, feeQueue, disputes, failedTransfers, connectIssues] = await Promise.all([
    rows<{ currency: string; fees30: number; feesAll: number; refunded30: number; disputedOpen: number; disputesOpen: number }>(sql`
      SELECT currency,
             coalesce(sum("applicationFeeAmount") FILTER (WHERE status = 'SUCCEEDED' AND "paidAt" > now() - interval '30 days'), 0)::bigint::float8 AS "fees30",
             coalesce(sum("applicationFeeAmount") FILTER (WHERE status = 'SUCCEEDED'), 0)::bigint::float8 AS "feesAll",
             coalesce(sum("refundedAmount") FILTER (WHERE "refundedAt" > now() - interval '30 days'), 0)::bigint::float8 AS "refunded30",
             coalesce(sum(coalesce("disputedAmount", amount)) FILTER (WHERE "disputeStatus" IN ('WARNING_NEEDS_RESPONSE', 'WARNING_UNDER_REVIEW', 'NEEDS_RESPONSE', 'UNDER_REVIEW')), 0)::bigint::float8 AS "disputedOpen",
             count(*) FILTER (WHERE "disputeStatus" IN ('WARNING_NEEDS_RESPONSE', 'WARNING_UNDER_REVIEW', 'NEEDS_RESPONSE', 'UNDER_REVIEW'))::int AS "disputesOpen"
        FROM "PaymentTransaction" GROUP BY currency ORDER BY "feesAll" DESC`),
    // Fee queue: succeeded payments whose payouts to club/coach aren't settled yet first.
    rows<PaymentRow>(sql`
      SELECT * FROM (
        SELECT pt.id, c.name AS "clubName", pt.amount, pt."applicationFeeAmount", pt.currency, pt.status::text AS status,
               pt."refundStatus"::text AS "refundStatus", pt."disputeStatus"::text AS "disputeStatus", pt."paidAt", pt."createdAt",
               (SELECT count(*)::int FROM "PaymentTransfer" tr WHERE tr."paymentId" = pt.id AND tr.status = 'PENDING') AS "transfersPending",
               (SELECT count(*)::int FROM "PaymentTransfer" tr WHERE tr."paymentId" = pt.id AND tr.status IN ('FAILED', 'REVERSED')) AS "transfersFailed"
          FROM "PaymentTransaction" pt JOIN "Club" c ON c.id = pt."clubId"
         WHERE pt.status = 'SUCCEEDED'
      ) p
      ORDER BY (p."transfersPending" + p."transfersFailed" > 0) DESC, p."paidAt" DESC NULLS LAST
      LIMIT 15`),
    rows<{
      id: string;
      clubName: string;
      amount: number;
      disputedAmount: number | null;
      currency: string;
      disputeStatus: string;
      disputeReason: string | null;
      stripeDisputeId: string | null;
      updatedAt: string;
    }>(sql`
      SELECT pt.id, c.name AS "clubName", pt.amount, pt."disputedAmount", pt.currency, pt."disputeStatus"::text AS "disputeStatus",
             pt."disputeReason", pt."stripeDisputeId", pt."updatedAt"
        FROM "PaymentTransaction" pt JOIN "Club" c ON c.id = pt."clubId"
       WHERE pt."disputeStatus" <> 'NONE'
       ORDER BY (pt."disputeStatus" IN ('NEEDS_RESPONSE', 'WARNING_NEEDS_RESPONSE')) DESC, pt."updatedAt" DESC
       LIMIT 20`),
    rows<{
      id: string;
      recipientType: string;
      amount: number;
      currency: string;
      status: string;
      stripeTransferId: string | null;
      accountId: string;
      owner: string;
      updatedAt: string;
    }>(sql`
      SELECT tr.id, tr."recipientType"::text AS "recipientType", tr.amount, tr.currency, tr.status::text AS status, tr."stripeTransferId",
             sa."stripeAccountId" AS "accountId", coalesce(c.name, u.email) AS owner, tr."updatedAt"
        FROM "PaymentTransfer" tr
        JOIN "StripeAccount" sa ON sa.id = tr."stripeAccountId"
        LEFT JOIN "Club" c ON c.id = sa."clubId"
        LEFT JOIN "User" u ON u.id = sa."userId"
       WHERE tr.status IN ('FAILED', 'REVERSED')
       ORDER BY tr."updatedAt" DESC LIMIT 20`),
    rows<{
      stripeAccountId: string;
      status: string;
      chargesEnabled: boolean;
      payoutsEnabled: boolean;
      requirementsDue: string[];
      disabledReason: string | null;
      owner: string;
      href: string;
    }>(sql`
      SELECT sa."stripeAccountId", sa.status::text AS status, sa."chargesEnabled", sa."payoutsEnabled", sa."requirementsDue",
             sa."disabledReason", coalesce(c.name, u.email) AS owner,
             CASE WHEN sa."clubId" IS NOT NULL THEN '/admin/tenants/club/' || sa."clubId" ELSE '/admin/tenants/coach/' || sa."userId" END AS href
        FROM "StripeAccount" sa LEFT JOIN "Club" c ON c.id = sa."clubId" LEFT JOIN "User" u ON u.id = sa."userId"
       WHERE NOT (sa."chargesEnabled" AND sa."payoutsEnabled") OR sa.status IN ('RESTRICTED', 'REJECTED')
       ORDER BY (sa.status IN ('RESTRICTED', 'REJECTED')) DESC, sa."updatedAt" DESC LIMIT 20`),
  ]);
  return { fees, feeQueue, disputes, failedTransfers, connectIssues };
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

export async function listPlans() {
  const [plans, subscribers] = await Promise.all([
    db.select().from(subscriptionPlan).orderBy(subscriptionPlan.tier),
    rows<{ tier: string; live: number }>(sql`
      SELECT s.tier::text AS tier, count(*)::int AS live FROM "Subscription" s WHERE ${LIVE_SUB} GROUP BY s.tier`),
  ]);
  const live = new Map(subscribers.map((s) => [s.tier, s.live]));
  const order = ["FREE_COACH", "PRO_COACH", "CLUB_BASIC", "CLUB_ENTERPRISE"];
  return plans
    .map((plan) => ({ ...plan, liveSubscriptions: live.get(plan.tier) ?? 0 }))
    .sort((a, b) => order.indexOf(a.tier) - order.indexOf(b.tier));
}

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

async function auditFor(targetType: "club" | "coach", targetId: string) {
  return db
    .select()
    .from(adminAuditLog)
    .where(and(eq(adminAuditLog.targetType, targetType), eq(adminAuditLog.targetId, targetId)))
    .orderBy(desc(adminAuditLog.createdAt))
    .limit(10);
}

export async function listAuditLog({ page }: { page: number }) {
  const [entries, [{ total = 0 } = {}]] = await Promise.all([
    db
      .select()
      .from(adminAuditLog)
      .orderBy(desc(adminAuditLog.createdAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ total: sql<number>`count(*)::int` }).from(adminAuditLog),
  ]);
  return { entries, total };
}

export async function listWebhookEvents({ q, status, page }: { q: string; status: "all" | "failed" | "pending"; page: number }) {
  const pattern = `%${escapeLike(q)}%`;
  const where = sql`(${q} = '' OR ${stripeWebhookEvent.type} ILIKE ${pattern} ESCAPE '\\' OR ${stripeWebhookEvent.id} ILIKE ${pattern} ESCAPE '\\')
    AND (${status} = 'all'
      OR (${status} = 'failed' AND ${stripeWebhookEvent.error} IS NOT NULL)
      OR (${status} = 'pending' AND ${stripeWebhookEvent.processedAt} IS NULL AND ${stripeWebhookEvent.error} IS NULL))`;
  const [events, [{ total = 0 } = {}]] = await Promise.all([
    db
      .select()
      .from(stripeWebhookEvent)
      .where(where)
      .orderBy(desc(stripeWebhookEvent.createdAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ total: sql<number>`count(*)::int` }).from(stripeWebhookEvent).where(where),
  ]);
  return { events, total };
}

export async function webhookSummary() {
  const [row] = await rows<{ last24: number; failed24: number; pending: number }>(sql`
    SELECT count(*) FILTER (WHERE "createdAt" > now() - interval '24 hours')::int AS last24,
           count(*) FILTER (WHERE "createdAt" > now() - interval '24 hours' AND error IS NOT NULL)::int AS failed24,
           count(*) FILTER (WHERE "processedAt" IS NULL AND error IS NULL)::int AS pending
      FROM "StripeWebhookEvent"`);
  return row!;
}
