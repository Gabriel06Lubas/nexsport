import { redirect } from "next/navigation";

import { requireOnboardedUser } from "@/modules/auth/dal";
import { homePathFor } from "@/modules/auth/lib/roles";

/** Entry point after sign-in: sends each role to its own dashboard. */
export default async function DashboardIndex() {
  const user = await requireOnboardedUser();
  redirect(homePathFor(user.role));
}
