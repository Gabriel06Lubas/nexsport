import "server-only";

import { and, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";

import { db, type Tx } from "@/db";
import { club, clubMember, facility, practiceSession, sessionParticipant, subscription, subscriptionPlan, user } from "@/db/schema";
import type { SubscriptionTier } from "@/db/schema/enums";
import { planFactsFor, type PlanFeature } from "@/config/pricing";

// What a club or a coach has paid for, checked on the server.
//
// Every Server Action that creates something a plan limits, or uses a
// feature a plan unlocks, asks here first; the UI hiding a button is a
// convenience, never the check. Rules:
//   * A club's plan comes from its live Subscription row, which only the
//     Stripe webhook writes. A club with no subscription, or one that is
//     PAST_DUE, CANCELED, UNPAID, INCOMPLETE or PAUSED, is not entitled to
//     anything: requireActiveSubscription() refuses (TRIALING counts as active).
//   * A coach is on Free Coach unless they have a live PRO_COACH subscription.
//   * Limits are read from SubscriptionPlan (admins can edit them), features
//     from src/config/plans.json.
//   * Checks that count rows (facilities, staff, students) take a row lock
//     on the club or the coach first, inside the caller's transaction, so two
//     concurrent requests can't both squeeze under a limit.

/** Subscription statuses that keep a plan's features switched on. */
export const ENTITLED_STATUSES = ["ACTIVE", "TRIALING"] as const;

type Executor = typeof db | Tx;

export type EntitlementCode = "NO_SUBSCRIPTION" | "SUBSCRIPTION_INACTIVE" | "LIMIT_REACHED" | "FEATURE_NOT_IN_PLAN";

export class EntitlementError extends Error {
  constructor(
    readonly code: EntitlementCode,
    message: string,
  ) {
    super(message);
    this.name = "EntitlementError";
  }
}

export type Decision = { allowed: true } | { allowed: false; code: EntitlementCode; reason: string };
const allow: Decision = { allowed: true };
const deny = (code: EntitlementCode, reason: string): Decision => ({ allowed: false, code, reason });

const statusText: Record<string, string> = {
  PAST_DUE: "past due: the last payment failed",
  CANCELED: "cancelled",
  UNPAID: "unpaid",
  INCOMPLETE: "waiting for its first payment",
  INCOMPLETE_EXPIRED: "expired before it was paid",
  PAUSED: "paused",
};

// ---------------------------------------------------------------------------
// Clubs
// ---------------------------------------------------------------------------

export type ClubEntitlements = {
  tier: SubscriptionTier | null;
  status: string | null;
  active: boolean;
  planName: string | null;
  limits: { maxFacilities: number | null; maxStaff: number | null; maxAthletes: number | null };
  features: readonly PlanFeature[];
  stripeCustomerId: string | null;
};

/** The club's current subscription and what it entitles the club to. */
export async function getClubEntitlements(clubId: string, ex: Executor = db): Promise<ClubEntitlements> {
  // The live subscription if there is one, otherwise the most recent.
  const [sub] = await ex
    .select({ tier: subscription.tier, status: subscription.status, stripeCustomerId: subscription.stripeCustomerId })
    .from(subscription)
    .where(and(eq(subscription.clubId, clubId), isNotNull(subscription.clubId)))
    .orderBy(sql`(${subscription.status} NOT IN ('CANCELED', 'INCOMPLETE_EXPIRED')) DESC`, desc(subscription.createdAt))
    .limit(1);
  if (!sub) return { tier: null, status: null, active: false, planName: null, limits: { maxFacilities: 0, maxStaff: 0, maxAthletes: 0 }, features: [], stripeCustomerId: null };
  const [plan] = await ex
    .select({ name: subscriptionPlan.name, maxFacilities: subscriptionPlan.maxFacilities, maxStaff: subscriptionPlan.maxStaff, maxAthletes: subscriptionPlan.maxAthletes })
    .from(subscriptionPlan)
    .where(eq(subscriptionPlan.tier, sub.tier));
  const active = (ENTITLED_STATUSES as readonly string[]).includes(sub.status);
  return {
    tier: sub.tier,
    status: sub.status,
    active,
    planName: plan?.name ?? sub.tier,
    limits: { maxFacilities: plan?.maxFacilities ?? null, maxStaff: plan?.maxStaff ?? null, maxAthletes: plan?.maxAthletes ?? null },
    features: active ? planFactsFor(sub.tier).features : [],
    stripeCustomerId: sub.stripeCustomerId,
  };
}

/**
 * The club's subscription must be ACTIVE (or TRIALING). Throws an
 * EntitlementError otherwise: no subscription, PAST_DUE, CANCELED, ….
 */
export async function requireActiveSubscription(clubId: string, ex: Executor = db): Promise<ClubEntitlements> {
  const ent = await getClubEntitlements(clubId, ex);
  if (!ent.status) throw new EntitlementError("NO_SUBSCRIPTION", "This club has no plan yet. Choose one on the Billing page.");
  if (!ent.active) {
    throw new EntitlementError("SUBSCRIPTION_INACTIVE", `This club's subscription is ${statusText[ent.status] ?? ent.status.toLowerCase()}. Update it on the Billing page to continue.`);
  }
  return ent;
}

/** Locks the club row for the rest of the transaction (READ COMMITTED: later counts see committed rows). */
async function lockClub(tx: Tx, clubId: string) {
  await tx.select({ id: club.id }).from(club).where(eq(club.id, clubId)).for("update");
}

async function limitDecision(
  tx: Tx,
  clubId: string,
  limit: "maxFacilities" | "maxStaff" | "maxAthletes",
  count: () => Promise<number>,
  describe: (planName: string, max: number) => string,
): Promise<Decision> {
  await lockClub(tx, clubId);
  let ent: ClubEntitlements;
  try {
    ent = await requireActiveSubscription(clubId, tx);
  } catch (e) {
    if (e instanceof EntitlementError) return deny(e.code, e.message);
    throw e;
  }
  const max = ent.limits[limit];
  if (max === null) return allow;
  return (await count()) >= max ? deny("LIMIT_REACHED", describe(ent.planName ?? "current", max)) : allow;
}

/**
 * Can the club add (or reactivate) a court/field? Counts active facilities
 * against the plan's maxFacilities (Club Basic: 5). Call inside the
 * transaction that inserts, so the lock covers the insert.
 */
export async function canCreateFacility(clubId: string, tx: Tx): Promise<Decision> {
  return limitDecision(
    tx,
    clubId,
    "maxFacilities",
    async () => (await tx.select({ n: sql<number>`count(*)::int` }).from(facility).where(and(eq(facility.clubId, clubId), eq(facility.isActive, true))))[0]?.n ?? 0,
    (plan, max) => `Your ${plan} plan includes ${max} active facilities. Deactivate one or upgrade to add more.`,
  );
}

/** Can the club add a staff member or coach to its roster? */
export async function canAddStaff(clubId: string, tx: Tx): Promise<Decision> {
  return limitDecision(
    tx,
    clubId,
    "maxStaff",
    async () =>
      (
        await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(clubMember)
          .where(and(eq(clubMember.clubId, clubId), inArray(clubMember.role, ["STAFF", "COACH"]), inArray(clubMember.status, ["INVITED", "ACTIVE"])))
      )[0]?.n ?? 0,
    (plan, max) => `Your ${plan} plan includes ${max} staff and coaches. Remove someone or upgrade.`,
  );
}

/** Can the club take on another active member (athlete)? */
export async function canAddClubMember(clubId: string, tx: Tx): Promise<Decision> {
  return limitDecision(
    tx,
    clubId,
    "maxAthletes",
    async () =>
      (
        await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(clubMember)
          .where(and(eq(clubMember.clubId, clubId), eq(clubMember.role, "STUDENT"), eq(clubMember.status, "ACTIVE")))
      )[0]?.n ?? 0,
    (plan, max) => `Your ${plan} plan includes ${max} athletes. Upgrade to add more members.`,
  );
}

/** Whether the club's active plan includes a feature (Club Enterprise: payroll, open matches, …). */
export async function hasClubFeature(clubId: string, feature: PlanFeature, ex: Executor = db): Promise<boolean> {
  const ent = await getClubEntitlements(clubId, ex);
  return ent.active && ent.features.includes(feature);
}

export async function requireClubFeature(clubId: string, feature: PlanFeature, ex: Executor = db): Promise<ClubEntitlements> {
  const ent = await requireActiveSubscription(clubId, ex);
  if (!ent.features.includes(feature)) {
    throw new EntitlementError("FEATURE_NOT_IN_PLAN", `This is part of Club Enterprise. ${ent.planName ?? "Your plan"} doesn't include it.`);
  }
  return ent;
}

// ---------------------------------------------------------------------------
// Coaches
// ---------------------------------------------------------------------------

export type CoachEntitlements = { tier: "FREE_COACH" | "PRO_COACH"; status: string | null; maxStudents: number | null; features: readonly PlanFeature[] };

/** Free Coach unless the coach has a live (ACTIVE / TRIALING) Pro Coach subscription. */
export async function getCoachEntitlements(coachId: string, ex: Executor = db): Promise<CoachEntitlements> {
  const [pro] = await ex
    .select({ status: subscription.status })
    .from(subscription)
    .where(and(eq(subscription.userId, coachId), eq(subscription.tier, "PRO_COACH"), inArray(subscription.status, [...ENTITLED_STATUSES])))
    .limit(1);
  const tier = pro ? "PRO_COACH" : "FREE_COACH";
  const [plan] = await ex.select({ maxAthletes: subscriptionPlan.maxAthletes }).from(subscriptionPlan).where(eq(subscriptionPlan.tier, tier));
  return { tier, status: pro?.status ?? null, maxStudents: plan ? plan.maxAthletes : planFactsFor(tier).limits.maxAthletes, features: planFactsFor(tier).features };
}

export async function hasCoachFeature(coachId: string, feature: PlanFeature, ex: Executor = db): Promise<boolean> {
  return (await getCoachEntitlements(coachId, ex)).features.includes(feature);
}

/**
 * A coach's active students: distinct students in the coach's own private
 * sessions (their coaching business, as opposed to classes run for a club)
 * that are upcoming or took place in the last 30 days.
 */
export async function countActiveStudents(coachId: string, ex: Executor = db): Promise<{ count: number; ids: Set<string> }> {
  const rows = await ex
    .selectDistinct({ userId: sessionParticipant.userId })
    .from(sessionParticipant)
    .innerJoin(practiceSession, eq(practiceSession.id, sessionParticipant.sessionId))
    .where(
      and(
        eq(practiceSession.coachId, coachId),
        eq(practiceSession.kind, "PRIVATE"),
        ne(practiceSession.status, "CANCELLED"),
        eq(sessionParticipant.status, "ACCEPTED"),
        sql`${practiceSession.endsAt} > now() - interval '30 days'`,
      ),
    );
  return { count: rows.length, ids: new Set(rows.map((r) => r.userId)) };
}

/**
 * Can the coach take on this student in a private session? Free Coach is
 * capped (15 active students); someone already among them never counts twice.
 * Inside a transaction, the coach's row is locked first so concurrent
 * bookings can't both take the last place.
 */
export async function canAddStudent(coachId: string, studentId: string | null = null, tx?: Tx): Promise<Decision> {
  if (tx) await tx.select({ id: user.id }).from(user).where(eq(user.id, coachId)).for("update");
  const ex = tx ?? db;
  const ent = await getCoachEntitlements(coachId, ex);
  if (ent.maxStudents === null) return allow;
  const { count, ids } = await countActiveStudents(coachId, ex);
  if (studentId && ids.has(studentId)) return allow;
  return count >= ent.maxStudents
    ? deny("LIMIT_REACHED", `Free Coach includes ${ent.maxStudents} active students. Upgrade to Pro Coach for unlimited students.`)
    : allow;
}

/** Throws EntitlementError unless allowed: for transactions that must abort. */
export function enforce(decision: Decision): void {
  if (!decision.allowed) throw new EntitlementError(decision.code, decision.reason);
}
