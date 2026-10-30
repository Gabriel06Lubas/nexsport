"use server";

import { and, eq, gt, inArray, isNotNull, isNull, lt, lte, ne, sql } from "drizzle-orm";

import { db } from "@/db";
import { attendance, club, memberPass, passCreditAdjustment, practiceSession, sessionParticipant } from "@/db/schema";
import { formValues, invalid, type ActionState } from "@/lib/action-state";

import { getCoachClubs, requireCoach } from "../dal";
import { attendanceSchema, creditSchema } from "../lib/forms";
import { isStudentAt } from "../queries/students";
import { revalidateCoach } from "./shared";

// Check-in and credit tracking. A coach marks attendance only on their own
// sessions, once they've started. A coach can change credits only on passes
// at a club where they're an active coach, held by one of their students
// there; every change is written to PassCreditAdjustment with who and why.

export async function markAttendance(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const coach = await requireCoach();
  const parsed = attendanceSchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: "Unknown check-in." };
  const { participantId, status } = parsed.data;

  const [p] = await db
    .select({ sessionId: sessionParticipant.sessionId, userId: sessionParticipant.userId })
    .from(sessionParticipant)
    .innerJoin(practiceSession, eq(practiceSession.id, sessionParticipant.sessionId))
    .where(
      and(
        eq(sessionParticipant.id, participantId),
        eq(sessionParticipant.status, "ACCEPTED"),
        eq(practiceSession.coachId, coach.id),
        ne(practiceSession.status, "CANCELLED"),
        // Check-in opens 30 minutes before the start.
        lte(practiceSession.startsAt, sql`now() + interval '30 minutes'`),
      ),
    );
  if (!p) return { error: "Attendance can be marked on your sessions from 30 minutes before they start." };

  const checkedInAt = status === "PRESENT" || status === "LATE" ? new Date() : null;
  await db
    .insert(attendance)
    .values({ sessionId: p.sessionId, participantId, userId: p.userId, status, markedById: coach.id, checkedInAt })
    .onConflictDoUpdate({ target: attendance.participantId, set: { status, markedById: coach.id, checkedInAt, updatedAt: new Date() } });
  revalidateCoach("", "/students");
  return { ok: `Marked ${status.toLowerCase()}.` };
}

export async function adjustCredit(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const coach = await requireCoach();
  const values = formValues(formData);
  const parsed = creditSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error, values);
  const { passId, direction } = parsed.data;

  const clubs = await getCoachClubs(coach.id);
  const [pass] = await db
    .select({ clubId: memberPass.clubId, userId: memberPass.userId, clubStatus: club.status })
    .from(memberPass)
    .innerJoin(club, eq(club.id, memberPass.clubId))
    .where(and(eq(memberPass.id, passId), inArray(memberPass.clubId, clubs.length ? clubs.map((c) => c.clubId) : [""])));
  if (!pass || !(await isStudentAt(coach.id, pass.userId, pass.clubId))) return { error: "You can only change passes of your students at your clubs." };
  if (pass.clubStatus === "SUSPENDED") return { error: "That club is suspended, so passes can't change." };

  const deduct = direction === "deduct";
  const result = await db.transaction(async (tx) => {
    // One conditional UPDATE: concurrent changes can't overspend or overrefund.
    const rows = await tx
      .update(memberPass)
      .set({ creditsUsed: sql`${memberPass.creditsUsed} + ${deduct ? 1 : -1}` })
      .where(
        and(
          eq(memberPass.id, passId),
          isNull(memberPass.cancelledAt),
          isNotNull(memberPass.creditsTotal),
          deduct ? lt(memberPass.creditsUsed, memberPass.creditsTotal) : gt(memberPass.creditsUsed, 0),
          deduct ? lte(memberPass.startsAt, sql`now()`) : sql`true`,
          gt(memberPass.expiresAt, sql`now()`),
        ),
      )
      .returning({ used: memberPass.creditsUsed, total: memberPass.creditsTotal });
    if (rows.length === 0) return null;
    await tx.insert(passCreditAdjustment).values({
      clubId: pass.clubId,
      passId,
      delta: deduct ? 1 : -1,
      reason: parsed.data.reason ?? (deduct ? "Session attended" : "Credit returned by coach"),
      actorId: coach.id,
    });
    return rows[0] as { used: number; total: number };
  });
  if (!result) return { error: deduct ? "No credits left, or the pass isn't valid today." : "Nothing to give back on that pass." };
  revalidateCoach("/students");
  return { ok: `${result.total - result.used} of ${result.total} left.` };
}
