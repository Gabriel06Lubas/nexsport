import "server-only";

import { and, eq, isNull, ne } from "drizzle-orm";
import { redirect } from "next/navigation";
import { cache } from "react";

import { db } from "@/db";
import { club, clubMember, coachProfile } from "@/db/schema";
import { requireOnboardedUser, type CurrentUser } from "@/modules/auth/dal";
import { homePathFor } from "@/modules/auth/lib/roles";

// Gate for /dashboard/coach. The proxy only checks that a session cookie
// exists (sessions live in the database, so the role can't be read at the
// edge); the role is checked here, in the coach layout, every page and every
// action. Anyone who isn't a COACH is sent to their own home: an admin to
// /admin, a club owner to their club.

export async function requireCoach(): Promise<CurrentUser> {
  const user = await requireOnboardedUser();
  if (user.role !== "COACH") redirect(homePathFor(user.role));
  return user;
}

export type CoachClub = {
  memberId: string;
  clubId: string;
  slug: string;
  name: string;
  timezone: string;
  currency: string;
  status: "PENDING_SETUP" | "ACTIVE" | "SUSPENDED" | "ARCHIVED";
  employmentType: "EMPLOYEE" | "FREELANCE" | null;
  commissionBps: number | null;
};

/** Clubs where the coach is an ACTIVE COACH on the roster: where they can schedule. */
export const getCoachClubs = cache(async (userId: string): Promise<CoachClub[]> => {
  return db
    .select({
      memberId: clubMember.id,
      clubId: club.id,
      slug: club.slug,
      name: club.name,
      timezone: club.timezone,
      currency: club.currency,
      status: club.status,
      employmentType: clubMember.employmentType,
      commissionBps: clubMember.commissionBps,
    })
    .from(clubMember)
    .innerJoin(club, eq(club.id, clubMember.clubId))
    .where(
      and(eq(clubMember.userId, userId), eq(clubMember.role, "COACH"), eq(clubMember.status, "ACTIVE"), isNull(club.deletedAt), ne(club.status, "ARCHIVED")),
    )
    .orderBy(club.name);
});

/** The coach's share of a session's net revenue at a club: employees are paid wages instead. */
export function coachShareFor(c: Pick<CoachClub, "employmentType" | "commissionBps">): number {
  return c.employmentType === "EMPLOYEE" ? 0 : (c.commissionBps ?? 7000);
}

/** The coach's profile, created on first use with a slug from their name. */
export const getCoachProfile = cache(async (user: CurrentUser) => {
  const [existing] = await db.select().from(coachProfile).where(eq(coachProfile.userId, user.id));
  if (existing) return existing;
  const clubs = await getCoachClubs(user.id);
  const base =
    (user.name ?? user.email.split("@")[0] ?? "coach")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "coach";
  // Unique slug: the name, then the name plus a short suffix of the user id.
  for (const slug of [base.length >= 3 ? base : `coach-${base}`, `${base}-${user.id.slice(-6)}`]) {
    const [created] = await db
      .insert(coachProfile)
      .values({ userId: user.id, slug, timezone: clubs[0]?.timezone ?? "UTC", currency: clubs[0]?.currency ?? "eur" })
      .onConflictDoNothing()
      .returning();
    if (created) return created;
    const [raced] = await db.select().from(coachProfile).where(eq(coachProfile.userId, user.id));
    if (raced) return raced;
  }
  throw new Error("Could not create a coach profile");
});

export type CoachProfileRow = Awaited<ReturnType<typeof getCoachProfile>>;
