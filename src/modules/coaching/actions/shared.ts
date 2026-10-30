import "server-only";

import { revalidatePath } from "next/cache";

import { isBookingConflict } from "@/db/errors";
import { conflictMessage as clubConflictMessage } from "@/modules/clubs/actions/shared";

const messages: Record<string, string> = {
  PracticeSession_coach_no_overlap: "You already have a session at that time.",
  CoachAvailability_no_overlap: "That overlaps one of your availability windows on one of the selected days.",
  SessionParticipant_capacity: "That session is full.",
  EquipmentBooking_capacity: "Not enough of that equipment is free at that time.",
};

/** A booking-guard rejection (SQLSTATE 23P01) as a coach-facing message, or null. */
export function coachConflictMessage(error: unknown): string | null {
  const constraint = isBookingConflict(error);
  if (!constraint) return null;
  return messages[constraint] ?? clubConflictMessage(error);
}

export function revalidateCoach(...sections: string[]) {
  for (const s of sections.length ? sections : [""]) revalidatePath(`/dashboard/coach${s}`);
}
