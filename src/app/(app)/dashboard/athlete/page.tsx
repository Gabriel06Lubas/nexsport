import type { Metadata } from "next";

import { AreaPlaceholder } from "@/modules/auth/components/area-placeholder";
import { requireArea } from "@/modules/auth/dal";

export const metadata: Metadata = { title: "Athlete home" };

export default async function AthleteHomePage() {
  const user = await requireArea("athlete");
  return <AreaPlaceholder user={user} title="Athlete home" description="Your session invites, squad chats and sports profile." />;
}
