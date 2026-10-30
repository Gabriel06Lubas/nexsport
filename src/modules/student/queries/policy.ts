import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { cancellationPolicy, cancellationPolicyRule } from "@/db/schema";
import type { RefundPolicy } from "@/modules/billing/lib/refund-policy";

import { DEFAULT_POLICY } from "../lib/cancellation";

export type LoadedPolicy = RefundPolicy & { id: string | null; name: string };

/** The session's own policy, else the club's default, else nexport's 24-hour default. */
export async function loadPolicy(clubId: string, policyId: string | null): Promise<LoadedPolicy> {
  const [policy] = await db
    .select()
    .from(cancellationPolicy)
    .where(
      and(
        eq(cancellationPolicy.clubId, clubId),
        eq(cancellationPolicy.isActive, true),
        policyId ? eq(cancellationPolicy.id, policyId) : eq(cancellationPolicy.isDefault, true),
      ),
    )
    .limit(1);
  if (!policy) return { ...DEFAULT_POLICY, id: null, name: "Full refund up to 24 hours before" };
  const rules = await db
    .select({ minHoursBeforeStart: cancellationPolicyRule.minHoursBeforeStart, refundPercent: cancellationPolicyRule.refundPercent })
    .from(cancellationPolicyRule)
    .where(eq(cancellationPolicyRule.policyId, policy.id))
    .orderBy(asc(cancellationPolicyRule.minHoursBeforeStart));
  return { id: policy.id, name: policy.name, organizerCancelRefundPercent: policy.organizerCancelRefundPercent, rules };
}

/** Policies for several clubs at once (for lists). */
export async function loadPolicies(keys: { clubId: string; policyId: string | null }[]) {
  const unique = new Map(keys.map((k) => [`${k.clubId}:${k.policyId ?? ""}`, k]));
  const loaded = await Promise.all([...unique.entries()].map(async ([key, k]) => [key, await loadPolicy(k.clubId, k.policyId)] as const));
  const map = new Map(loaded);
  return (clubId: string, policyId: string | null) => map.get(`${clubId}:${policyId ?? ""}`)!;
}
