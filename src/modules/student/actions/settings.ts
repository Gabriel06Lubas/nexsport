"use server";

import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Route } from "next";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { db } from "@/db";
import { athletePreferredClub, athleteSettings, club, profile, profileSport, sport } from "@/db/schema";
import { formValues, invalid, type ActionState } from "@/lib/action-state";
import { createPortalSession, ensureCustomer, getStripe } from "@/modules/payments/stripe";

import { requireStudent } from "../dal";
import { levelSchema, preferencesSchema } from "../lib/forms";

export async function savePreferences(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const student = await requireStudent();
  const values = formValues(formData);
  const parsed = preferencesSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error, values);
  const { matchAlerts, bookingUpdates, clubs } = parsed.data;

  const known = clubs.length
    ? await db.select({ id: club.id }).from(club).where(and(inArray(club.id, clubs), isNull(club.deletedAt)))
    : [];
  await db.transaction(async (tx) => {
    await tx
      .insert(athleteSettings)
      .values({ userId: student.id, matchAlerts, bookingUpdates })
      .onConflictDoUpdate({ target: athleteSettings.userId, set: { matchAlerts, bookingUpdates, updatedAt: new Date() } });
    await tx.delete(athletePreferredClub).where(eq(athletePreferredClub.userId, student.id));
    if (known.length) await tx.insert(athletePreferredClub).values(known.map((c) => ({ userId: student.id, clubId: c.id })));
  });
  revalidatePath("/dashboard/student", "layout");
  return { ok: "Preferences saved." };
}

/** Levels arrive as level_<sportId> fields, one per active sport. */
export async function saveLevels(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const student = await requireStudent();
  const values = formValues(formData);
  const [mine] = await db.select({ id: profile.id }).from(profile).where(eq(profile.userId, student.id));
  if (!mine) return { error: "Finish onboarding first." };
  const sports = await db.select({ id: sport.id }).from(sport).where(eq(sport.isActive, true));

  const fieldErrors: Record<string, string> = {};
  const levels: { sportId: string; level: number | null }[] = [];
  for (const s of sports) {
    const parsed = levelSchema.safeParse(values[`level_${s.id}`]);
    if (!parsed.success) fieldErrors[`level_${s.id}`] = parsed.error.issues[0]?.message ?? "Invalid level";
    else levels.push({ sportId: s.id, level: parsed.data });
  }
  if (Object.keys(fieldErrors).length) return { error: "Check the highlighted fields.", fieldErrors, values };

  await db.transaction(async (tx) => {
    for (const { sportId, level } of levels) {
      if (level === null) {
        await tx.delete(profileSport).where(and(eq(profileSport.profileId, mine.id), eq(profileSport.sportId, sportId)));
      } else {
        await tx
          .insert(profileSport)
          .values({ profileId: mine.id, sportId, levelRating: level, level: `Level ${level.toFixed(1)}` })
          .onConflictDoUpdate({ target: [profileSport.profileId, profileSport.sportId], set: { levelRating: level, level: `Level ${level.toFixed(1)}` } });
      }
    }
  });
  revalidatePath("/dashboard/student", "layout");
  return { ok: "Levels saved. The match board uses them right away." };
}

/** Stripe's hosted portal: add, remove and default cards; see invoices. */
export async function openBillingPortal(_prev: ActionState, _formData: FormData): Promise<ActionState> {
  const student = await requireStudent();
  const stripe = getStripe();
  if (!stripe) return { error: "Online payments aren't enabled on this deployment." };
  let url: string;
  try {
    const customerId = await ensureCustomer(stripe, student);
    url = await createPortalSession(stripe, customerId, "/dashboard/student/settings");
  } catch (error) {
    console.error("[stripe] portal failed", error);
    return { error: "Stripe is unavailable right now. Try again in a moment." };
  }
  redirect(url as Route);
}
