import "server-only";

import { and, eq, inArray, notInArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import type { Tx } from "@/db";
import { isBookingConflict } from "@/db/errors";
import { club, subscription, subscriptionPlan } from "@/db/schema";
import type { ClubPermission } from "@/db/schema/enums";
import type { ActionState } from "@/lib/action-state";

import { requireClubAccess, type ClubAccess } from "../dal";

// Shared guard for every club dashboard Server Action. Server Actions are
// public HTTP endpoints, so each one re-checks, from scratch: the session,
// membership of the club named in the form, the permission it needs, and
// that the platform hasn't suspended the club. The club comes from the
// form's `clubSlug`; every query below is then scoped to that club's id.

export type WriteGuard = { access: ClubAccess } | { state: ActionState };

export async function guardClubWrite(formData: FormData, permission: ClubPermission | "OWNER"): Promise<WriteGuard> {
  const slug = String(formData.get("clubSlug") ?? "");
  const access = await requireClubAccess(slug, permission === "OWNER" ? undefined : permission);
  if (permission === "OWNER" && access.role !== "OWNER") return { state: { error: "Only the club owner can do this." } };
  if (access.readOnly) return { state: { error: "This club is suspended by nexport, so nothing can be changed. Contact support." } };
  return { access };
}

export function revalidateClub(access: ClubAccess, section = "") {
  revalidatePath(`/dashboard/${access.club.slug}${section}`);
}

const conflictMessages: Record<string, string> = {
  FacilityBooking_no_overlap: "That court is already rented at that time.",
  PracticeSession_facility_no_overlap: "A coached session already uses that court at that time.",
  Facility_booking_overlap: "That time clashes with a coached session or another booking on this facility.",
  FacilityPriceRule_no_overlap: "That window overlaps an existing price rule on one of the selected days.",
  EquipmentMaintenance_capacity: "That's more units than are left in service.",
  EquipmentBooking_capacity: "Units are reserved for upcoming sessions, so the stock can't go that low.",
};

/** Maps a booking-guard rejection (SQLSTATE 23P01) to a message, or null. */
export function conflictMessage(error: unknown): string | null {
  const constraint = isBookingConflict(error);
  return constraint ? (conflictMessages[constraint] ?? "That conflicts with an existing booking.") : null;
}

/**
 * The club's plan limits: from its live subscription's plan, or the Club
 * Basic plan while it has none. Locks the Club row so two concurrent
 * additions can't both squeeze under the limit (READ COMMITTED: the counts
 * that follow see everything committed before the lock was granted).
 */
export async function lockClubAndGetLimits(tx: Tx, clubId: string) {
  await tx.select({ id: club.id }).from(club).where(eq(club.id, clubId)).for("update");
  const [live] = await tx
    .select({ tier: subscription.tier })
    .from(subscription)
    .where(and(eq(subscription.clubId, clubId), notInArray(subscription.status, ["CANCELED", "INCOMPLETE_EXPIRED"])))
    .limit(1);
  const tier = live && (live.tier === "CLUB_BASIC" || live.tier === "CLUB_ENTERPRISE") ? live.tier : "CLUB_BASIC";
  const [plan] = await tx
    .select({ name: subscriptionPlan.name, maxFacilities: subscriptionPlan.maxFacilities, maxStaff: subscriptionPlan.maxStaff, maxAthletes: subscriptionPlan.maxAthletes })
    .from(subscriptionPlan)
    .where(inArray(subscriptionPlan.tier, [tier]));
  return plan ?? { name: "Club Basic", maxFacilities: null, maxStaff: null, maxAthletes: null };
}

export class LimitReached extends Error {}
