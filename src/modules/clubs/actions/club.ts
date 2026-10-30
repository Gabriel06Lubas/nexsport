"use server";

import { eq } from "drizzle-orm";
import type { Route } from "next";
import { redirect } from "next/navigation";

import { db } from "@/db";
import { isUniqueViolation } from "@/db/errors";
import { club, clubMember, user as userTable } from "@/db/schema";
import { formValues, invalid, type ActionState } from "@/lib/action-state";
import { requireOnboardedUser } from "@/modules/auth/dal";

import { createClubSchema } from "../lib/forms";

/** A club owner creates their club; they become its OWNER member. */
export async function createClub(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const current = await requireOnboardedUser();
  if (current.role !== "CLUB_OWNER") return { error: "Only club owner accounts can create a club." };
  const values = formValues(formData);
  const parsed = createClubSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error, values);
  const input = parsed.data;

  try {
    await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(club)
        .values({ ...input, ownerId: current.id, status: "PENDING_SETUP" })
        .returning({ id: club.id });
      await tx.insert(clubMember).values({ clubId: created!.id, userId: current.id, role: "OWNER", status: "ACTIVE", joinedAt: new Date() });
      await tx.update(userTable).set({ activeClubId: created!.id }).where(eq(userTable.id, current.id));
    });
  } catch (e) {
    if (isUniqueViolation(e, "Club_slug_key")) return { error: "Check the highlighted fields.", fieldErrors: { slug: "That address is taken" }, values };
    throw e;
  }
  redirect(`/dashboard/${input.slug}` as Route);
}
