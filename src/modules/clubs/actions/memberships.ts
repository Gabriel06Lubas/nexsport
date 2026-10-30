"use server";

import { and, count, eq, gt, isNotNull, isNull, lt, lte, sql } from "drizzle-orm";

import { db } from "@/db";
import { isUniqueViolation } from "@/db/errors";
import { clubMember, memberPass, membershipPlan, passCreditAdjustment, user } from "@/db/schema";
import { formValues, invalid, type ActionState } from "@/lib/action-state";

import { idOnly, membershipPlanSchema, sellPassSchema } from "../lib/forms";
import { addDays, zonedParts, zonedToUtc } from "../lib/zoned-time";
import { guardClubWrite, LimitReached, lockClubAndGetLimits, revalidateClub } from "./shared";

// Membership plans and the passes sold from them. A pass copies its plan's
// terms (credits, price, validity) when sold, so editing a plan only changes
// what future buyers get.

const SECTION = "/memberships";

export async function savePlan(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const guard = await guardClubWrite(formData, "MANAGE_MEMBERS");
  if ("state" in guard) return guard.state;
  const { access } = guard;
  const values = formValues(formData);
  const parsed = membershipPlanSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error, values);
  const { planId, price, ...fields } = parsed.data;
  const row = { ...fields, priceAmount: price, currency: access.club.currency };

  try {
    if (planId) {
      const updated = await db
        .update(membershipPlan)
        .set(row)
        .where(and(eq(membershipPlan.id, planId), eq(membershipPlan.clubId, access.club.id)))
        .returning({ id: membershipPlan.id });
      if (updated.length === 0) return { error: "That plan no longer exists." };
    } else {
      await db.insert(membershipPlan).values({ ...row, clubId: access.club.id });
    }
  } catch (e) {
    if (isUniqueViolation(e, "MembershipPlan_clubId_name_key")) return { error: "Check the highlighted fields.", fieldErrors: { name: "You already have a plan with that name" }, values };
    throw e;
  }
  revalidateClub(access, SECTION);
  return { ok: planId ? "Plan updated. Passes already sold keep their terms." : "Plan created." };
}

export async function setPlanActive(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const guard = await guardClubWrite(formData, "MANAGE_MEMBERS");
  if ("state" in guard) return guard.state;
  const { access } = guard;
  const parsed = idOnly("planId").safeParse(formValues(formData));
  if (!parsed.success) return { error: "Unknown plan." };
  const active = formData.get("active") === "true";
  await db
    .update(membershipPlan)
    .set({ isActive: active })
    .where(and(eq(membershipPlan.id, String(parsed.data.planId)), eq(membershipPlan.clubId, access.club.id)));
  revalidateClub(access, SECTION);
  return { ok: active ? "Plan is on sale again." : "Plan withdrawn from sale. Existing passes stay valid." };
}

export async function sellPass(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const guard = await guardClubWrite(formData, "MANAGE_MEMBERS");
  if ("state" in guard) return guard.state;
  const { access } = guard;
  const values = formValues(formData);
  const parsed = sellPassSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error, values);
  const input = parsed.data;
  const fail = (field: string, message: string): ActionState => ({ error: "Check the highlighted fields.", fieldErrors: { [field]: message }, values });

  const [plan] = await db
    .select()
    .from(membershipPlan)
    .where(and(eq(membershipPlan.id, input.planId), eq(membershipPlan.clubId, access.club.id), eq(membershipPlan.isActive, true)));
  if (!plan) return fail("planId", "Pick a plan that's on sale");

  const [buyer] = await db.select({ id: user.id }).from(user).where(and(eq(user.email, input.email), isNull(user.deletedAt)));
  if (!buyer) return fail("email", "No nexport account uses that email. Ask the member to sign up first.");

  const tz = access.club.timezone;
  const today = zonedParts(new Date(), tz).dateKey;
  const startDate = input.startDate ?? today;
  if (startDate < today) return fail("startDate", "A pass can't start in the past");
  const startsAt = startDate === today ? new Date() : zonedToUtc(startDate, 0, tz);
  const expiresAt = zonedToUtc(addDays(startDate, plan.durationDays), 0, tz);
  if (!startsAt || !expiresAt) return fail("startDate", "Pick another start date");

  try {
    await db.transaction(async (tx) => {
      // The buyer becomes (or stays) an active student member of the club.
      const limits = await lockClubAndGetLimits(tx, access.club.id);
      const [membership] = await tx
        .select({ id: clubMember.id, status: clubMember.status })
        .from(clubMember)
        .where(and(eq(clubMember.clubId, access.club.id), eq(clubMember.userId, buyer.id), eq(clubMember.role, "STUDENT")));
      if (membership?.status !== "ACTIVE") {
        const [{ n = 0 } = {}] = await tx
          .select({ n: count() })
          .from(clubMember)
          .where(and(eq(clubMember.clubId, access.club.id), eq(clubMember.role, "STUDENT"), eq(clubMember.status, "ACTIVE")));
        if (limits.maxAthletes !== null && n >= limits.maxAthletes) {
          throw new LimitReached(`Your ${limits.name} plan includes ${limits.maxAthletes} athletes. Upgrade to add more members.`);
        }
        if (membership) {
          await tx.update(clubMember).set({ status: "ACTIVE", joinedAt: new Date(), leftAt: null }).where(eq(clubMember.id, membership.id));
        } else {
          await tx.insert(clubMember).values({ clubId: access.club.id, userId: buyer.id, role: "STUDENT", status: "ACTIVE", joinedAt: new Date() });
        }
      }
      await tx.insert(memberPass).values({
        clubId: access.club.id,
        planId: plan.id,
        userId: buyer.id,
        creditsTotal: plan.creditCount,
        startsAt,
        expiresAt,
        priceAmount: plan.priceAmount,
        currency: plan.currency,
        paymentMethod: input.paymentMethod,
        paidAt: input.paymentMethod === "ON_SITE" ? new Date() : null,
        soldById: access.user.id,
      });
    });
  } catch (e) {
    if (e instanceof LimitReached) return { error: e.message, values };
    throw e;
  }
  revalidateClub(access, SECTION);
  revalidateClub(access);
  return { ok: `${plan.name} sold to ${input.email}.` };
}

export async function redeemCredit(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const guard = await guardClubWrite(formData, "MANAGE_MEMBERS");
  if ("state" in guard) return guard.state;
  const { access } = guard;
  const parsed = idOnly("passId").safeParse(formValues(formData));
  if (!parsed.success) return { error: "Unknown pass." };
  // One atomic statement: two check-ins at once can't spend the same credit.
  // The ledger row is written in the same transaction.
  const passId = String(parsed.data.passId);
  const updated = await db.transaction(async (tx) => {
    const rows = await tx
      .update(memberPass)
      .set({ creditsUsed: sql`${memberPass.creditsUsed} + 1` })
      .where(
        and(
          eq(memberPass.id, passId),
          eq(memberPass.clubId, access.club.id),
          isNull(memberPass.cancelledAt),
          isNotNull(memberPass.creditsTotal),
          lt(memberPass.creditsUsed, memberPass.creditsTotal),
          lte(memberPass.startsAt, sql`now()`),
          gt(memberPass.expiresAt, sql`now()`),
        ),
      )
      .returning({ used: memberPass.creditsUsed, total: memberPass.creditsTotal });
    if (rows.length > 0) {
      await tx.insert(passCreditAdjustment).values({ clubId: access.club.id, passId, delta: 1, reason: "Used at the desk", actorId: access.user.id });
    }
    return rows;
  });
  if (updated.length === 0) return { error: "No credits left on that pass, or it isn't valid today." };
  const [{ used, total }] = updated as [{ used: number; total: number }];
  revalidateClub(access, SECTION);
  return { ok: `Credit used: ${total - used} of ${total} left.` };
}

export async function cancelPass(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const guard = await guardClubWrite(formData, "MANAGE_MEMBERS");
  if ("state" in guard) return guard.state;
  const { access } = guard;
  const parsed = idOnly("passId").safeParse(formValues(formData));
  if (!parsed.success) return { error: "Unknown pass." };
  const updated = await db
    .update(memberPass)
    .set({ cancelledAt: sql`now()` })
    .where(and(eq(memberPass.id, String(parsed.data.passId)), eq(memberPass.clubId, access.club.id), isNull(memberPass.cancelledAt)))
    .returning({ id: memberPass.id });
  if (updated.length === 0) return { error: "That pass is already cancelled." };
  revalidateClub(access, SECTION);
  revalidateClub(access);
  return { ok: "Pass cancelled." };
}

