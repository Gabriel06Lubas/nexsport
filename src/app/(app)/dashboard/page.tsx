import { redirect } from "next/navigation";

import { requireOnboardedUser, requireUser } from "@/modules/auth/dal";
import { homePathFor } from "@/modules/auth/lib/roles";

/** Entry point after sign-in: sends each role to its own dashboard. */
export default async function DashboardIndex() {
  // Admins are created in the database and skip onboarding.
  if ((await requireUser()).role === "ADMIN") redirect("/admin");
  const user = await requireOnboardedUser();
  redirect(homePathFor(user.role));
}
