import "server-only";

import { revalidatePath } from "next/cache";

import { isBookingConflict } from "@/db/errors";
import type { ClubPermission } from "@/db/schema/enums";
import type { ActionState } from "@/lib/action-state";
import { EntitlementError, requireActiveSubscription, type Decision } from "@/lib/entitlements";

import { requireClubAccess, type ClubAccess } from "../dal";

// Shared guard for every club dashboard Server Action. Server Actions are
// public HTTP endpoints, so each one re-checks, from scratch: the session,
// membership of the club named in the form, the permission it needs, that
// the platform hasn't suspended the club, and that the club's subscription
// is ACTIVE (or TRIALING): a PAST_DUE, CANCELED or missing subscription
// blocks every write until it's fixed on the Billing page. The club comes
// from the form's `clubSlug`; every query below is then scoped to that
// club's id.

export type WriteGuard = { access: ClubAccess } | { state: ActionState };

export async function guardClubWrite(formData: FormData, permission: ClubPermission | "OWNER"): Promise<WriteGuard> {
  const slug = String(formData.get("clubSlug") ?? "");
  const access = await requireClubAccess(slug, permission === "OWNER" ? undefined : permission);
  if (permission === "OWNER" && access.role !== "OWNER") return { state: { error: "Only the club owner can do this." } };
  if (access.readOnly) return { state: { error: "This club is suspended by nexport, so nothing can be changed. Contact support." } };
  try {
    await requireActiveSubscription(access.club.id);
  } catch (e) {
    if (e instanceof EntitlementError) return { state: { error: e.message } };
    throw e;
  }
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

export class LimitReached extends Error {}

/** Aborts the surrounding transaction when a plan limit (or the subscription) says no. */
export function enforceLimit(decision: Decision): void {
  if (!decision.allowed) throw new LimitReached(decision.reason);
}
