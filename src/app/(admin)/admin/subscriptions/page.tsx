import { Info } from "lucide-react";
import type { Metadata } from "next";

import { PlanEditor } from "@/modules/admin/components/plan-editor";
import { PageHeader } from "@/modules/admin/components/ui";
import { listPlans } from "@/modules/admin/queries";
import { requireAdmin } from "@/modules/auth/dal";

export const metadata: Metadata = { title: "Subscription Tiers" };

export default async function SubscriptionsPage() {
  await requireAdmin();
  const plans = await listPlans();

  return (
    <div className="space-y-6">
      <PageHeader title="Subscription tiers" description="Prices, platform fees, limits and the Stripe Price behind each plan." />
      <p className="flex gap-3 rounded-2xl border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          Stripe Prices can’t be edited. To change what new customers pay, create a new Price in your Stripe dashboard and paste its
          ID here together with the new amount. Existing subscribers keep their current price until their subscription changes in
          Stripe. Every save is recorded in the audit log.
        </span>
      </p>
      <div className="grid grid-cols-1 gap-6 2xl:grid-cols-2">
        {plans.map((plan) => (
          <PlanEditor key={plan.tier} plan={{ ...plan, updatedAt: plan.updatedAt.toISOString() }} />
        ))}
      </div>
    </div>
  );
}
