import type { Metadata } from "next";

import { AreaPlaceholder } from "@/modules/auth/components/area-placeholder";
import { requireArea } from "@/modules/auth/dal";

export const metadata: Metadata = { title: "Coach dashboard" };

export default async function CoachDashboardPage() {
  const user = await requireArea("coach");
  return <AreaPlaceholder user={user} title="Coach dashboard" description="Your sessions, invites, attendance and payouts." />;
}
