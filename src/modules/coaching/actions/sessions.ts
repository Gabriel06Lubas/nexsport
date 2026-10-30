"use server";

import { and, eq, gt, inArray, isNull, lte, sql } from "drizzle-orm";

import { db } from "@/db";
import { isUniqueViolation } from "@/db/errors";
import { equipment, equipmentBooking, facility, paymentTransaction, practiceSession, sessionParticipant, sport, user } from "@/db/schema";
import { formValues, invalid, type ActionState } from "@/lib/action-state";
import { idOnly } from "@/modules/clubs/lib/forms";
import { minuteToTime, zonedToUtc } from "@/modules/clubs/lib/zoned-time";

import { coachShareFor, getCoachClubs, requireCoach } from "../dal";
import { addParticipantSchema, cancelSessionSchema, sessionSchema } from "../lib/forms";
import { coachConflictMessage, revalidateCoach } from "./shared";

// Sessions a coach runs. A coach schedules only at clubs where they're an
// active coach on the roster (and the club isn't suspended), on that club's
// facilities. The database refuses: the facility already in use (session or
// rental), the coach already busy anywhere, equipment over-allocated, a full
// session. Everything happens in one transaction, so a refused equipment
// reservation also undoes the session.

export async function createSession(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const coach = await requireCoach();
  const values = formValues(formData);
  const parsed = sessionSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error, values);
  const s = parsed.data;
  const fail = (field: string, message: string): ActionState => ({ error: "Check the highlighted fields.", fieldErrors: { [field]: message }, values });

  const clubs = await getCoachClubs(coach.id);
  const [court] = await db
    .select({ id: facility.id, clubId: facility.clubId, name: facility.name, isActive: facility.isActive, openMinute: facility.openMinute, closeMinute: facility.closeMinute, capacity: facility.capacity })
    .from(facility)
    .where(and(eq(facility.id, s.facilityId), inArray(facility.clubId, clubs.length ? clubs.map((c) => c.clubId) : [""])));
  const club = clubs.find((c) => c.clubId === court?.clubId);
  if (!court || !club || !court.isActive) return fail("facilityId", "Pick a facility at one of your clubs");
  if (club.status === "SUSPENDED") return fail("facilityId", `${club.name} is suspended; sessions can't be scheduled there`);
  if (s.startTime < court.openMinute || s.endTime > court.closeMinute) {
    return fail("startTime", `${court.name} is open ${minuteToTime(court.openMinute)}–${minuteToTime(court.closeMinute)} (${club.timezone})`);
  }
  const [sportRow] = await db.select({ id: sport.id }).from(sport).where(and(eq(sport.id, s.sportId), eq(sport.isActive, true)));
  if (!sportRow) return fail("sportId", "Pick a sport");

  const startsAt = zonedToUtc(s.date, s.startTime, club.timezone);
  const endsAt = zonedToUtc(s.date, s.endTime, club.timezone);
  if (!startsAt || !endsAt) return fail("startTime", "That time doesn't exist on that date (clock change)");
  if (startsAt.getTime() <= Date.now()) return fail("date", "Pick a time in the future");

  const max = s.maxParticipants ?? (s.kind === "PRIVATE" ? 1 : court.capacity);
  if (court.capacity !== null && max !== null && max > court.capacity) return fail("maxParticipants", `${court.name} holds ${court.capacity} people`);

  let studentId: string | null = null;
  if (s.studentEmail) {
    const [student] = await db.select({ id: user.id }).from(user).where(and(eq(user.email, s.studentEmail), isNull(user.deletedAt)));
    if (!student) return fail("studentEmail", "No nexport account uses that email");
    if (student.id === coach.id) return fail("studentEmail", "You can't be your own student");
    studentId = student.id;
  }
  if (s.equipmentId) {
    const [item] = await db.select({ clubId: equipment.clubId }).from(equipment).where(eq(equipment.id, s.equipmentId));
    if (item?.clubId !== club.clubId) return fail("equipmentId", "Pick equipment from the same club as the facility");
  }

  try {
    await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(practiceSession)
        .values({
          clubId: club.clubId,
          facilityId: court.id,
          coachId: coach.id,
          sportId: s.sportId,
          createdById: coach.id,
          title: s.title,
          kind: s.kind,
          startsAt,
          endsAt,
          maxParticipants: max,
          priceAmount: s.price ?? 0,
          currency: club.currency,
          coachShareBps: coachShareFor(club),
        })
        .returning({ id: practiceSession.id });
      if (s.equipmentId && s.equipmentQuantity) {
        await tx.insert(equipmentBooking).values({
          clubId: club.clubId,
          equipmentId: s.equipmentId,
          sessionId: created!.id,
          quantity: s.equipmentQuantity,
          startsAt,
          endsAt,
        });
      }
      if (studentId) {
        await tx.insert(sessionParticipant).values({ sessionId: created!.id, userId: studentId, status: "ACCEPTED", invitedById: coach.id, respondedAt: new Date() });
      }
    });
  } catch (e) {
    const message = coachConflictMessage(e);
    if (message) return { error: message, values };
    throw e;
  }
  revalidateCoach("", "/students");
  return { ok: `Scheduled “${s.title}” at ${club.name} · ${court.name}, ${s.date} ${minuteToTime(s.startTime)}–${minuteToTime(s.endTime)}.` };
}

/** Sessions the coach runs, by id: the scope of every action below. */
const ownSession = (coachId: string, sessionId: string) => and(eq(practiceSession.id, sessionId), eq(practiceSession.coachId, coachId));

export async function cancelSession(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const coach = await requireCoach();
  const values = formValues(formData);
  const parsed = cancelSessionSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error, values);
  // Paid seats are refunded through Stripe, which this button can't do yet.
  const [paid] = await db
    .select({ id: paymentTransaction.id })
    .from(paymentTransaction)
    .where(and(eq(paymentTransaction.sessionId, parsed.data.sessionId), eq(paymentTransaction.status, "SUCCEEDED")))
    .limit(1);
  if (paid) return { error: "Students have paid for this session; it has to be cancelled with refunds through Stripe." };
  const updated = await db
    .update(practiceSession)
    .set({ status: "CANCELLED", cancelledAt: sql`now()`, cancelledById: coach.id, cancellationReason: parsed.data.reason })
    .where(and(ownSession(coach.id, parsed.data.sessionId), eq(practiceSession.status, "SCHEDULED"), gt(practiceSession.startsAt, sql`now()`)))
    .returning({ id: practiceSession.id });
  if (updated.length === 0) return { error: "Only your upcoming, scheduled sessions can be cancelled." };
  revalidateCoach("", "/students");
  return { ok: "Session cancelled. The court and any equipment are free again." };
}

export async function completeSession(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const coach = await requireCoach();
  const parsed = idOnly("sessionId").safeParse(formValues(formData));
  if (!parsed.success) return { error: "Unknown session." };
  const updated = await db
    .update(practiceSession)
    .set({ status: "COMPLETED" })
    .where(and(ownSession(coach.id, String(parsed.data.sessionId)), inArray(practiceSession.status, ["SCHEDULED", "IN_PROGRESS"]), lte(practiceSession.startsAt, sql`now()`)))
    .returning({ id: practiceSession.id });
  if (updated.length === 0) return { error: "Only sessions that have started can be completed." };
  revalidateCoach("", "/students");
  return { ok: "Completed. It now counts towards your hours." };
}

export async function addParticipant(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const coach = await requireCoach();
  const values = formValues(formData);
  const parsed = addParticipantSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error, values);
  const [session] = await db
    .select({ id: practiceSession.id })
    .from(practiceSession)
    .where(and(ownSession(coach.id, parsed.data.sessionId), eq(practiceSession.status, "SCHEDULED")));
  if (!session) return { error: "Students can only join your scheduled sessions." };
  const [student] = await db.select({ id: user.id }).from(user).where(and(eq(user.email, parsed.data.email), isNull(user.deletedAt)));
  if (!student) return { error: "No nexport account uses that email.", fieldErrors: { email: "Unknown email" }, values };
  if (student.id === coach.id) return { error: "You can't be your own student.", values };
  try {
    await db.insert(sessionParticipant).values({ sessionId: session.id, userId: student.id, status: "ACCEPTED", invitedById: coach.id, respondedAt: new Date() });
  } catch (e) {
    if (isUniqueViolation(e, "SessionParticipant_sessionId_userId_key")) return { error: "They're already in this session.", values };
    const message = coachConflictMessage(e);
    if (message) return { error: message, values };
    throw e;
  }
  revalidateCoach("", "/students");
  return { ok: `${parsed.data.email} added.` };
}
