import "server-only";

import { eq } from "drizzle-orm";

import type { Tx } from "@/db";
import { isUniqueViolation } from "@/db/errors";
import { profile, user } from "@/db/schema";

import type { PersonalDetails } from "./lib/personal";

/**
 * Writes validated personal details: the Profile (created if missing) and the
 * account's name, so the rest of the app (rosters, receipts, emails) shows it.
 * Returns "handle-taken" when someone else already has the username.
 */
export async function savePersonalDetails(tx: Tx, userId: string, d: PersonalDetails): Promise<"ok" | "handle-taken"> {
  const values = { handle: d.handle, displayName: d.displayName, firstName: d.firstName, lastName: d.lastName, phone: d.phone };
  try {
    await tx.transaction(async (sp) => {
      const [existing] = await sp.select({ id: profile.id }).from(profile).where(eq(profile.userId, userId));
      if (existing) await sp.update(profile).set(values).where(eq(profile.id, existing.id));
      else await sp.insert(profile).values({ userId, ...values });
      await sp.update(user).set({ name: d.displayName }).where(eq(user.id, userId));
    });
  } catch (e) {
    if (isUniqueViolation(e, "Profile_handle_key")) return "handle-taken";
    throw e;
  }
  return "ok";
}

export const handleTaken = { error: "Check the highlighted fields.", fieldErrors: { handle: "That username is taken" } };
