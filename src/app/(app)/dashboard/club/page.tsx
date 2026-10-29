import type { Metadata } from "next";

import { AreaPlaceholder } from "@/modules/auth/components/area-placeholder";
import { requireArea } from "@/modules/auth/dal";

export const metadata: Metadata = { title: "Club dashboard" };

export default async function ClubDashboardPage() {
  const user = await requireArea("club");
  return <AreaPlaceholder user={user} title="Club dashboard" description="Revenue, members, facilities, equipment and staff for your club." />;
}
