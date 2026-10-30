"use server";

import { and, count, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { isUniqueViolation } from "@/db/errors";
import { coachAvailability, coachProfile, facility, sport } from "@/db/schema";
import { formValues, invalid, type ActionState } from "@/lib/action-state";
import { idSchema } from "@/lib/validation";

import { getCoachClubs, getCoachProfile, requireCoach } from "../dal";
import { availabilitySchema, profileSchema } from "../lib/forms";
import { coachConflictMessage, revalidateCoach } from "./shared";

// The coach's public booking page and weekly availability.

export async function saveProfile(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const coach = await requireCoach();
  const values = formValues(formData);
  const parsed = profileSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error, values);
  const p = parsed.data;
  const fail = (field: string, message: string): ActionState => ({ error: "Check the highlighted fields.", fieldErrors: { [field]: message }, values });

  if (p.sportId) {
    const [found] = await db.select({ id: sport.id }).from(sport).where(and(eq(sport.id, p.sportId), eq(sport.isActive, true)));
    if (!found) return fail("sportId", "Pick a sport");
  }
  if (p.bookingEnabled) {
    if (p.privateRate === null) return fail("privateRate", "Set a private rate before opening bookings");
    if (!p.sportId) return fail("sportId", "Pick the sport students book you for");
    const [{ n = 0 } = {}] = await db.select({ n: count() }).from(coachAvailability).where(eq(coachAvailability.coachId, coach.id));
    if (n === 0) return fail("bookingEnabled", "Add at least one availability window first");
  }

  const current = await getCoachProfile(coach);
  try {
    await db
      .update(coachProfile)
      .set({
        slug: p.slug,
        headline: p.headline,
        bio: p.bio,
        timezone: p.timezone,
        sportId: p.sportId,
        privateRateAmount: p.privateRate,
        groupRateAmount: p.groupRate,
        sessionMinutes: p.sessionMinutes,
        minNoticeHours: p.minNoticeHours,
        maxAdvanceDays: p.maxAdvanceDays,
        bookingEnabled: p.bookingEnabled,
      })
      .where(eq(coachProfile.userId, coach.id));
  } catch (e) {
    if (isUniqueViolation(e, "CoachProfile_slug_key")) return fail("slug", "That link is taken");
    throw e;
  }
  revalidateCoach("/availability", "");
  revalidatePath(`/coach/${current.slug}`);
  revalidatePath(`/coach/${p.slug}`);
  return { ok: p.bookingEnabled ? "Saved. Your booking page is live." : "Saved. Your booking page is switched off." };
}

export async function addWindow(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const coach = await requireCoach();
  const values = formValues(formData);
  const parsed = availabilitySchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error, values);
  const w = parsed.data;

  const clubs = await getCoachClubs(coach.id);
  if (!clubs.some((c) => c.clubId === w.clubId)) return { error: "Pick one of your clubs.", fieldErrors: { clubId: "Pick one of your clubs" }, values };
  if (w.facilityId) {
    const [f] = await db.select({ clubId: facility.clubId }).from(facility).where(eq(facility.id, w.facilityId));
    if (f?.clubId !== w.clubId) return { error: "Check the highlighted fields.", fieldErrors: { facilityId: "Pick a facility at that club" }, values };
  }
  try {
    await db.insert(coachAvailability).values(
      w.days.map((dayOfWeek) => ({ coachId: coach.id, clubId: w.clubId, facilityId: w.facilityId, dayOfWeek, startMinute: w.startTime, endMinute: w.endTime })),
    );
  } catch (e) {
    const message = coachConflictMessage(e);
    if (message) return { error: message, values };
    throw e;
  }
  revalidateCoach("/availability");
  return { ok: `Availability added for ${w.days.length} ${w.days.length === 1 ? "day" : "days"}.` };
}

const windowIds = z
  .string()
  .transform((value) => value.split(","))
  .pipe(z.array(idSchema).min(1).max(7));

export async function deleteWindows(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const coach = await requireCoach();
  const parsed = windowIds.safeParse(formValues(formData).windowIds);
  if (!parsed.success) return { error: "Unknown window." };
  await db.delete(coachAvailability).where(and(inArray(coachAvailability.id, parsed.data), eq(coachAvailability.coachId, coach.id)));
  revalidateCoach("/availability");
  return { ok: "Removed." };
}
