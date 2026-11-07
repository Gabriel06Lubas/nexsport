"use server";

import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { formValues, invalid, type ActionState } from "@/lib/action-state";
import { assertNotImpersonating, requireOnboardedUser } from "@/modules/auth/dal";

import { personalDetailsSchema } from "./lib/personal";
import { handleTaken, savePersonalDetails } from "./save";

/** Settings → Personal details: the signed-in user's own name, username and phone. */
export async function updatePersonalDetails(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const me = await requireOnboardedUser();
  await assertNotImpersonating();
  const values = formValues(formData);
  const parsed = personalDetailsSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error, values);
  const saved = await db.transaction((tx) => savePersonalDetails(tx, me.id, parsed.data));
  if (saved === "handle-taken") return { ...handleTaken, values };
  revalidatePath("/", "layout");
  return { ok: "Saved." };
}
