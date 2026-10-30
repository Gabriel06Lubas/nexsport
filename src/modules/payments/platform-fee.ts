import "server-only";

import { and, eq, isNotNull, notInArray } from "drizzle-orm";

import { db } from "@/db";
import { subscription, subscriptionPlan } from "@/db/schema";

/** The platform take-rate on a club's bookings: its live subscription's, else Club Basic's. */
export async function platformFeeBpsFor(clubId: string): Promise<number> {
  const [live] = await db
    .select({ bps: subscription.platformFeeBps })
    .from(subscription)
    .where(and(eq(subscription.clubId, clubId), isNotNull(subscription.clubId), notInArray(subscription.status, ["CANCELED", "INCOMPLETE_EXPIRED"])))
    .limit(1);
  if (live) return live.bps;
  const [basic] = await db.select({ bps: subscriptionPlan.platformFeeBps }).from(subscriptionPlan).where(eq(subscriptionPlan.tier, "CLUB_BASIC"));
  return basic?.bps ?? 1000;
}
