import { Building2, CreditCard, Gauge, Landmark, ScrollText, ShieldAlert, UserPlus } from "lucide-react";
import type { Metadata, Route } from "next";
import Link from "next/link";

import { connectHealthPercent } from "@/modules/admin/lib/connect-status";
import { getOverview, getRecentActivity, webhookSummary, type ActivityItem } from "@/modules/admin/queries";
import { EmptyState, formatDateTime, KpiCard, moneyTotals, PageHeader, Panel } from "@/modules/admin/components/ui";
import { requireAdmin } from "@/modules/auth/dal";

export const metadata: Metadata = { title: "Overview" };

const activityIcon: Record<ActivityItem["kind"], typeof Building2> = {
  club_signup: Building2,
  coach_signup: UserPlus,
  subscription: CreditCard,
  dispute: ShieldAlert,
};

const activityLabel: Record<ActivityItem["kind"], string> = {
  club_signup: "New club",
  coach_signup: "New coach",
  subscription: "Subscription",
  dispute: "Dispute",
};

export default async function AdminOverviewPage() {
  await requireAdmin();
  const [overview, activity, webhooks] = await Promise.all([getOverview(), getRecentActivity(), webhookSummary()]);
  const { mrr, tenants, connect, volume, volume30 } = overview;
  const health = connectHealthPercent(connect.total, connect.healthy);
  const payingSubscriptions = mrr.reduce((n, row) => n + row.subscriptions, 0);
  const fees = volume.map((row) => ({ currency: row.currency, amount: row.fees }));

  return (
    <div className="space-y-6">
      <PageHeader title="Platform overview" description="Live figures across every club and coach on nexport." />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Platform MRR"
          icon={<CreditCard className="size-4" aria-hidden />}
          value={moneyTotals(mrr)}
          hint={`${payingSubscriptions} paying ${payingSubscriptions === 1 ? "subscription" : "subscriptions"} (active or past due)`}
        />
        <KpiCard
          label="Active tenants"
          icon={<Building2 className="size-4" aria-hidden />}
          value={tenants.clubs + tenants.coaches}
          hint={`${tenants.clubs} clubs · ${tenants.coaches} coaches (${tenants.proCoaches} pro)`}
        />
        <KpiCard
          label="Stripe Connect health"
          icon={<Gauge className="size-4" aria-hidden />}
          value={health === null ? "—" : `${health}%`}
          hint={connect.total ? `${connect.healthy} of ${connect.total} accounts can charge and pay out` : "No connected accounts yet"}
        />
        <KpiCard
          label="Total volume processed"
          icon={<Landmark className="size-4" aria-hidden />}
          value={moneyTotals(volume)}
          hint={`${moneyTotals(volume30)} in the last 30 days · ${moneyTotals(fees)} platform fees`}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Panel title="Recent activity" action={<Link href="/admin/tenants" className="text-sm font-medium text-accent-text hover:underline">All tenants</Link>}>
          {activity.length === 0 ? (
            <EmptyState>No activity yet. New clubs, coaches, subscriptions and disputes appear here.</EmptyState>
          ) : (
            <ul className="divide-y divide-border">
              {activity.map((item) => {
                const Icon = activityIcon[item.kind];
                const body = (
                  <>
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted">
                      <Icon className="size-4 text-muted-foreground" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        <span className="text-muted-foreground">{activityLabel[item.kind]}:</span> {item.title}
                      </span>
                      {item.detail && <span className="block truncate text-xs text-muted-foreground">{item.detail}</span>}
                    </span>
                    <time className="shrink-0 text-xs text-muted-foreground" dateTime={item.at.toISOString()}>
                      {formatDateTime(item.at)}
                    </time>
                  </>
                );
                return (
                  <li key={`${item.kind}-${item.id}`}>
                    {item.href ? (
                      <Link href={item.href as Route} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/60">
                        {body}
                      </Link>
                    ) : (
                      <div className="flex items-center gap-3 px-5 py-3">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <div className="min-w-0 space-y-6">
          <Panel title="Tenants">
            <dl className="grid grid-cols-2 gap-px bg-border">
              {[
                ["Active clubs", tenants.clubs],
                ["Suspended clubs", tenants.clubsSuspended],
                ["Active coaches", tenants.coaches],
                ["Suspended coaches", tenants.coachesSuspended],
              ].map(([label, value]) => (
                <div key={label} className="bg-card px-5 py-4">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="mt-1 text-lg font-semibold tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
          </Panel>
          <Panel
            title="Stripe webhooks (24 h)"
            action={<Link href="/admin/logs" className="text-sm font-medium text-accent-text hover:underline">Logs</Link>}
          >
            <div className="flex items-center gap-4 px-5 py-4">
              <ScrollText className="size-5 text-muted-foreground" aria-hidden />
              <p className="text-sm">
                <span className="font-semibold tabular-nums">{webhooks.last24}</span> received ·{" "}
                <span className={webhooks.failed24 ? "font-semibold text-danger" : ""}>{webhooks.failed24} failed</span> ·{" "}
                <span className={webhooks.pending ? "font-semibold text-warning" : ""}>{webhooks.pending} unprocessed</span>
              </p>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
