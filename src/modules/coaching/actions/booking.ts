"use server";

import { and, count, eq, gt, ne, sql } from "drizzle-orm";
import type { Route } from "next";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { db } from "@/db";
import { club, clubMember, practiceSession, sessionParticipant } from "@/db/schema";
import { isBookingConflict } from "@/db/errors";
import { formValues, type ActionState } from "@/lib/action-state";
import { requireOnboardedUser } from "@/modules/auth/dal";

import { coachShareFor } from "../dal";
import { bookSlotSchema } from "../lib/forms";
import { getOpenSlots, getPublicCoach } from "../queries/booking";

// Self-booking from a coach's public page (/coach/<slug>). The requested slot
// is checked against freshly computed open slots, so a forged time outside
// the coach's availability is refused; the database guards settle races (two
// students on the same slot: one wins). Payment is collected by the Stripe
// integration (Step 4); until then the seat is reserved and paid at the club.

/** Upcoming sessions one student may self-book with one coach (it holds a court, unpaid). */
const MAX_UPCOMING_PER_STUDENT = 3;

export async function bookSlot(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const student = await requireOnboardedUser();
  const parsed = bookSlotSchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: "That slot isn't available." };
  const coach = await getPublicCoach(parsed.data.coachSlug);
  if (!coach) return { error: "This coach isn't taking bookings right now." };
  if (coach.userId === student.id) return { error: "This is your own booking page." };

  const requested = new Date(parsed.data.startsAt).getTime();
  const slot = (await getOpenSlots(coach)).find((s) => s.startsAt.getTime() === requested && s.clubId === parsed.data.clubId);
  if (!slot) return { error: "That slot was just taken or isn't available any more. Pick another one." };

  const [{ n = 0 } = {}] = await db
    .select({ n: count() })
    .from(sessionParticipant)
    .innerJoin(practiceSession, eq(practiceSession.id, sessionParticipant.sessionId))
    .where(
      and(
        eq(sessionParticipant.userId, student.id),
        eq(practiceSession.createdById, student.id),
        eq(practiceSession.coachId, coach.userId),
        eq(practiceSession.kind, "PRIVATE"),
        ne(practiceSession.status, "CANCELLED"),
        gt(practiceSession.startsAt, sql`now()`),
      ),
    );
  if (n >= MAX_UPCOMING_PER_STUDENT) return { error: `You already have ${n} upcoming sessions with ${coach.name ?? "this coach"}.` };

  const [membership] = await db
    .select({ employmentType: clubMember.employmentType, commissionBps: clubMember.commissionBps, currency: club.currency })
    .from(clubMember)
    .innerJoin(club, eq(club.id, clubMember.clubId))
    .where(and(eq(clubMember.clubId, slot.clubId), eq(clubMember.userId, coach.userId), eq(clubMember.role, "COACH"), eq(clubMember.status, "ACTIVE")));
  if (!membership) return { error: "That slot isn't available." };
  const price = Math.round((coach.privateRateAmount * coach.sessionMinutes) / 60);

  // Try the free facilities in order; another booking may take one meanwhile.
  let bookedId: string | null = null;
  for (const facilityId of slot.facilityIds) {
    try {
      bookedId = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(practiceSession)
          .values({
            clubId: slot.clubId,
            facilityId,
            coachId: coach.userId,
            sportId: coach.sportId,
            createdById: student.id,
            title: `Private session · ${student.name ?? "student"}`,
            kind: "PRIVATE",
            startsAt: slot.startsAt,
            endsAt: slot.endsAt,
            maxParticipants: 1,
            priceAmount: price,
            currency: membership.currency,
            coachShareBps: coachShareFor(membership),
          })
          .returning({ id: practiceSession.id });
        await tx.insert(sessionParticipant).values({ sessionId: created!.id, userId: student.id, status: "ACCEPTED", respondedAt: new Date() });
        return created!.id;
      });
      break;
    } catch (e) {
      const constraint = isBookingConflict(e);
      if (constraint === "PracticeSession_coach_no_overlap") return { error: "Someone booked that slot a moment ago. Pick another one." };
      if (constraint) continue; // that facility was taken; try the next
      throw e;
    }
  }
  if (!bookedId) return { error: "Someone booked that slot a moment ago. Pick another one." };
  revalidatePath(`/coach/${coach.slug}`);
  revalidatePath("/dashboard/coach");
  // The booked slot leaves the list, so confirm on the page itself.
  redirect(`/coach/${coach.slug}?booked=${bookedId}` as Route);
}
