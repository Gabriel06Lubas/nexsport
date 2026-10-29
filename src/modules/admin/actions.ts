"use server";

import { and, desc, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import type { Route } from "next";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { db, type Tx } from "@/db";
import { isUniqueViolation } from "@/db/errors";
import { adminAuditLog, club, session, subscriptionPlan, user } from "@/db/schema";
import { idSchema, plainText } from "@/lib/validation";
import { getImpersonation, requireAdmin, type CurrentUser } from "@/modules/auth/dal";
import { startImpersonation, stopImpersonation } from "@/modules/auth/impersonation";

import { planFormSchema } from "./lib/plan-form";

// Admin actions. Each one re-checks requireAdmin() (Server Actions are public
// endpoints; the hidden admin UI is not a security boundary), validates every
// field, and writes an AdminAuditLog entry in the same transaction as the
// change it records.

export type ActionState = { error?: string; fieldErrors?: Record<string, string>; ok?: string };

type AuditInput = Omit<typeof adminAuditLog.$inferInsert, "id" | "createdAt" | "actorId" | "actorEmail">;

async function audit(tx: Tx | typeof db, actor: Pick<CurrentUser, "id" | "email">, entry: AuditInput) {
  await tx.insert(adminAuditLog).values({ ...entry, actorId: actor.id, actorEmail: actor.email });
}

const reasonSchema = plainText({ min: 5, max: 500, label: "reason" });
const tenantSchema = z.object({ kind: z.enum(["club", "coach"]), id: idSchema, reason: reasonSchema });

function tenantPath(kind: "club" | "coach", id: string) {
  return `/admin/tenants/${kind}/${id}` as Route;
}

// ---------------------------------------------------------------------------
// Subscription plans
// ---------------------------------------------------------------------------

export async function updatePlan(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = planFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0] ?? "form")] ??= issue.message;
    return { error: "Check the highlighted fields.", fieldErrors };
  }
  const { tier, expectedUpdatedAt, ...values } = parsed.data;

  try {
    const result = await db.transaction(async (tx) => {
      const [before] = await tx.select().from(subscriptionPlan).where(eq(subscriptionPlan.tier, tier)).for("update");
      if (!before) return "missing" as const;
      // Optimistic concurrency: refuse to overwrite an edit made since this form loaded.
      if (before.updatedAt.toISOString() !== new Date(expectedUpdatedAt).toISOString()) return "stale" as const;

      await tx
        .update(subscriptionPlan)
        .set({
          name: values.name,
          monthlyPriceAmount: values.monthlyPrice,
          platformFeeBps: values.platformFee,
          stripePriceId: values.stripePriceId,
          maxFacilities: values.maxFacilities,
          maxStaff: values.maxStaff,
          maxAthletes: values.maxAthletes,
          isActive: values.isActive,
          updatedById: admin.id,
        })
        .where(eq(subscriptionPlan.tier, tier));

      const after = {
        name: values.name,
        monthlyPriceAmount: values.monthlyPrice,
        platformFeeBps: values.platformFee,
        stripePriceId: values.stripePriceId,
        maxFacilities: values.maxFacilities,
        maxStaff: values.maxStaff,
        maxAthletes: values.maxAthletes,
        isActive: values.isActive,
      };
      const changes = Object.fromEntries(
        Object.entries(after)
          .filter(([key, value]) => before[key as keyof typeof after] !== value)
          .map(([key, value]) => [key, { from: before[key as keyof typeof after], to: value }]),
      );
      if (Object.keys(changes).length === 0) return "unchanged" as const;
      await audit(tx, admin, { action: "PLAN_UPDATED", targetType: "plan", targetId: tier, targetLabel: values.name, details: changes });
      return "saved" as const;
    });

    revalidatePath("/admin/subscriptions");
    if (result === "missing") return { error: "That plan doesn't exist." };
    if (result === "stale") return { error: "Someone else changed this plan since you opened the page. Reload to see their changes." };
    if (result === "unchanged") return { ok: "Nothing to save: no values changed." };
    return { ok: "Saved. Existing subscribers keep their current price until their subscription changes in Stripe." };
  } catch (error) {
    if (isUniqueViolation(error, "SubscriptionPlan_stripePriceId_key")) {
      return { error: "That Stripe Price ID is already used by another plan.", fieldErrors: { stripePriceId: "Already used by another plan" } };
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Suspend / reactivate
// ---------------------------------------------------------------------------

export async function suspendTenant(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = tenantSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid request" };
  const { kind, id, reason } = parsed.data;

  const label = await db.transaction(async (tx) => {
    if (kind === "club") {
      const [row] = await tx
        .update(club)
        .set({ status: "SUSPENDED" })
        .where(and(eq(club.id, id), isNull(club.deletedAt), ne(club.status, "SUSPENDED")))
        .returning({ name: club.name });
      if (!row) return null;
      await audit(tx, admin, { action: "TENANT_SUSPENDED", targetType: "club", targetId: id, targetLabel: row.name, reason });
      return row.name;
    }
    const [row] = await tx
      .update(user)
      .set({ suspendedAt: new Date(), suspensionReason: reason })
      .where(and(eq(user.id, id), eq(user.role, "COACH"), isNull(user.suspendedAt), isNull(user.deletedAt)))
      .returning({ email: user.email });
    if (!row) return null;
    // Signed out everywhere at once (the adapter would also refuse these sessions).
    await tx.delete(session).where(eq(session.userId, id));
    await audit(tx, admin, { action: "TENANT_SUSPENDED", targetType: "coach", targetId: id, targetLabel: row.email, reason });
    return row.email;
  });

  if (!label) return { error: "This tenant is already suspended or no longer exists." };
  revalidatePath("/admin", "layout");
  return { ok: `${label} has been suspended.` };
}

export async function reactivateTenant(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = tenantSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid request" };
  const { kind, id, reason } = parsed.data;

  const label = await db.transaction(async (tx) => {
    if (kind === "club") {
      const [row] = await tx
        .update(club)
        .set({ status: "ACTIVE" })
        .where(and(eq(club.id, id), isNull(club.deletedAt), eq(club.status, "SUSPENDED")))
        .returning({ name: club.name });
      if (!row) return null;
      await audit(tx, admin, { action: "TENANT_REACTIVATED", targetType: "club", targetId: id, targetLabel: row.name, reason });
      return row.name;
    }
    const [row] = await tx
      .update(user)
      .set({ suspendedAt: null, suspensionReason: null })
      .where(and(eq(user.id, id), eq(user.role, "COACH"), isNotNull(user.suspendedAt)))
      .returning({ email: user.email });
    if (!row) return null;
    await audit(tx, admin, { action: "TENANT_REACTIVATED", targetType: "coach", targetId: id, targetLabel: row.email, reason });
    return row.email;
  });

  if (!label) return { error: "This tenant isn't suspended." };
  revalidatePath("/admin", "layout");
  return { ok: `${label} has been reactivated.` };
}

// ---------------------------------------------------------------------------
// Impersonation
// ---------------------------------------------------------------------------

export async function impersonateTenant(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = tenantSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid request" };
  const { kind, id, reason } = parsed.data;

  // A club is impersonated through its owner's account.
  const [target] =
    kind === "club"
      ? await db
          .select({ userId: club.ownerId, label: club.name })
          .from(club)
          .where(and(eq(club.id, id), isNull(club.deletedAt)))
          .limit(1)
      : await db
          .select({ userId: user.id, label: user.email })
          .from(user)
          .where(and(eq(user.id, id), eq(user.role, "COACH")))
          .limit(1);
  if (!target) return { error: "This tenant no longer exists." };

  const started = await startImpersonation(admin.id, target.userId);
  if (!started.ok) return { error: started.reason };
  await audit(db, admin, {
    action: "IMPERSONATION_STARTED",
    targetType: kind,
    targetId: id,
    targetLabel: target.label,
    reason,
    details: { userId: target.userId },
  });
  redirect("/dashboard");
}

/** Called from the impersonation banner (by the impersonated session). */
export async function stopImpersonatingAction(): Promise<void> {
  // getImpersonation() reads *this browser's* session, so the entry always
  // names the account impersonated here (not another tab or device).
  const current = await getImpersonation();
  if (current) {
    const [started] = await db
      .select({ targetType: adminAuditLog.targetType, targetId: adminAuditLog.targetId, targetLabel: adminAuditLog.targetLabel })
      .from(adminAuditLog)
      .where(
        and(
          eq(adminAuditLog.action, "IMPERSONATION_STARTED"),
          eq(adminAuditLog.actorId, current.adminId),
          sql`${adminAuditLog.details} ->> 'userId' = ${current.userId}`,
        ),
      )
      .orderBy(desc(adminAuditLog.createdAt))
      .limit(1);
    await audit(db, { id: current.adminId, email: current.adminEmail }, {
      action: "IMPERSONATION_ENDED",
      targetType: started?.targetType ?? "coach",
      targetId: started?.targetId ?? current.userId,
      targetLabel: started?.targetLabel ?? null,
      details: { userId: current.userId },
    });
  }
  const restored = await stopImpersonation();
  redirect(restored ? "/admin/tenants" : "/login");
}
