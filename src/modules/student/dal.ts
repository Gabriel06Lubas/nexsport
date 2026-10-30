import "server-only";

import { redirect } from "next/navigation";

import { requireOnboardedUser, type CurrentUser } from "@/modules/auth/dal";
import { homePathFor } from "@/modules/auth/lib/roles";

// Gate for /dashboard/student. The proxy only checks that a session cookie
// exists (sessions live in the database); the role is checked here, in the
// layout, every page and every action. Anyone who isn't a STUDENT is sent
// to their own home.
export async function requireStudent(): Promise<CurrentUser> {
  const user = await requireOnboardedUser();
  if (user.role !== "STUDENT") redirect(homePathFor(user.role));
  return user;
}
