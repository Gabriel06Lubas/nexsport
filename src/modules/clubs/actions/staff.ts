"use server";

import { and, count, eq, inArray, isNull, ne } from "drizzle-orm";

import { db } from "@/db";
import { clubMember, user } from "@/db/schema";
import { formValues, invalid, type ActionState } from "@/lib/action-state";

import { addMemberSchema, addStaffSchema, idOnly, permissionsSchema, updatePaySchema } from "../lib/forms";
import { hasPermission } from "../lib/permissions";
import { guardClubWrite, LimitReached, lockClubAndGetLimits, revalidateClub } from "./shared";

// The staff & coach roster. Who may change what:
//   * adding or removing STAFF, and their permissions: the owner only, so a
//     staff member can never grant themselves (or anyone) more access;
//   * adding or removing coaches: MANAGE_MEMBERS (coaches get no dashboard access);
//   * pay terms (wage / commission), including when adding someone: MANAGE_BILLING.

const SECTION = "/staff";

export async function addStaffMember(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const role = formData.get("role") === "STAFF" ? "STAFF" : "COACH";
  const guard = await guardClubWrite(formData, role === "STAFF" ? "OWNER" : "MANAGE_MEMBERS");
  if ("state" in guard) return guard.state;
  const { access } = guard;
  const values = formValues(formData);
  // Pay terms are payroll data: only members with MANAGE_BILLING set them.
  const withPay = hasPermission(access, "MANAGE_BILLING");
  const parsed = withPay
    ? addStaffSchema.safeParse(values)
    : addMemberSchema.transform((m) => ({ ...m, employmentType: null, hourlyWage: null, commission: null })).safeParse(values);
  if (!parsed.success) return invalid(parsed.error, values);
  const input = parsed.data;
  const fail = (field: string, message: string): ActionState => ({ error: "Check the highlighted fields.", fieldErrors: { [field]: message }, values });

  const [person] = await db.select({ id: user.id, role: user.role }).from(user).where(and(eq(user.email, input.email), isNull(user.deletedAt)));
  if (!person) return fail("email", "No nexport account uses that email. Ask them to sign up first.");
  if (person.role === "ADMIN") return fail("email", "Platform admins can't join a club roster.");

  try {
    await db.transaction(async (tx) => {
      const limits = await lockClubAndGetLimits(tx, access.club.id);
      const [existing] = await tx
        .select({ id: clubMember.id, status: clubMember.status })
        .from(clubMember)
        .where(and(eq(clubMember.clubId, access.club.id), eq(clubMember.userId, person.id), eq(clubMember.role, input.role)));
      if (existing && existing.status !== "LEFT") throw new LimitReached(`They're already on your roster as ${input.role === "STAFF" ? "staff" : "a coach"}.`);

      const [{ n = 0 } = {}] = await tx
        .select({ n: count() })
        .from(clubMember)
        .where(and(eq(clubMember.clubId, access.club.id), inArray(clubMember.role, ["STAFF", "COACH"]), inArray(clubMember.status, ["INVITED", "ACTIVE"])));
      if (limits.maxStaff !== null && n >= limits.maxStaff) {
        throw new LimitReached(`Your ${limits.name} plan includes ${limits.maxStaff} staff and coaches. Remove someone or upgrade.`);
      }

      const pay = {
        title: input.title,
        employmentType: input.employmentType,
        hourlyWageAmount: input.employmentType === "EMPLOYEE" ? input.hourlyWage : null,
        commissionBps: input.employmentType === "FREELANCE" ? input.commission : null,
        status: "ACTIVE" as const,
        joinedAt: new Date(),
        leftAt: null,
        permissions: [],
      };
      if (existing) await tx.update(clubMember).set(pay).where(eq(clubMember.id, existing.id));
      else await tx.insert(clubMember).values({ ...pay, clubId: access.club.id, userId: person.id, role: input.role });
    });
  } catch (e) {
    if (e instanceof LimitReached) return { error: e.message, values };
    throw e;
  }
  revalidateClub(access, SECTION);
  return { ok: input.role === "STAFF" ? "Staff member added. Grant their permissions below." : "Coach added to the roster." };
}

export async function updatePay(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const guard = await guardClubWrite(formData, "MANAGE_BILLING");
  if ("state" in guard) return guard.state;
  const { access } = guard;
  const values = formValues(formData);
  const parsed = updatePaySchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error, values);
  const input = parsed.data;
  const updated = await db
    .update(clubMember)
    .set({
      title: input.title,
      employmentType: input.employmentType,
      hourlyWageAmount: input.employmentType === "EMPLOYEE" ? input.hourlyWage : null,
      commissionBps: input.employmentType === "FREELANCE" ? input.commission : null,
    })
    .where(and(eq(clubMember.id, input.memberId), eq(clubMember.clubId, access.club.id), inArray(clubMember.role, ["STAFF", "COACH"])))
    .returning({ id: clubMember.id });
  if (updated.length === 0) return { error: "That person is no longer on the roster." };
  revalidateClub(access, SECTION);
  return { ok: "Pay terms saved." };
}

export async function setPermissions(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const guard = await guardClubWrite(formData, "OWNER");
  if ("state" in guard) return guard.state;
  const { access } = guard;
  const values = formValues(formData);
  const parsed = permissionsSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error, values, "Unknown permission.");
  const updated = await db
    .update(clubMember)
    .set({ permissions: parsed.data.permissions })
    .where(and(eq(clubMember.id, parsed.data.memberId), eq(clubMember.clubId, access.club.id), eq(clubMember.role, "STAFF")))
    .returning({ id: clubMember.id });
  if (updated.length === 0) return { error: "Permissions only apply to staff members." };
  revalidateClub(access, SECTION);
  return { ok: "Permissions saved. They apply on the member's next page load." };
}

export async function removeFromRoster(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = idOnly("memberId").safeParse(formValues(formData));
  if (!parsed.success) return { error: "Unknown member." };
  const memberId = String(parsed.data.memberId);
  // Whether this needs the owner depends on the row's role, so look it up first
  // (scoped to the club the guard approves below).
  const role = formData.get("role") === "STAFF" ? "STAFF" : "COACH";
  const guard = await guardClubWrite(formData, role === "STAFF" ? "OWNER" : "MANAGE_MEMBERS");
  if ("state" in guard) return guard.state;
  const { access } = guard;
  const updated = await db
    .update(clubMember)
    .set({ status: "LEFT", leftAt: new Date(), permissions: [] })
    .where(
      and(
        eq(clubMember.id, memberId),
        eq(clubMember.clubId, access.club.id),
        eq(clubMember.role, role),
        ne(clubMember.userId, access.user.id),
        ne(clubMember.status, "LEFT"),
      ),
    )
    .returning({ id: clubMember.id });
  if (updated.length === 0) return { error: "That person isn't on the roster." };
  revalidateClub(access, SECTION);
  return { ok: role === "STAFF" ? "Removed. Their access ended immediately." : "Coach removed from the roster." };
}
