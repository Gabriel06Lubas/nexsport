import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { idSchema } from "@/lib/validation";
import { formatMoney } from "@/lib/utils";
import { TenantActions } from "@/modules/admin/components/tenant-actions";
import {
  ConnectBadge,
  EmptyState,
  formatDate,
  formatDateTime,
  Panel,
  StatusBadge,
  TableWrap,
  td,
  th,
  TierBadge,
} from "@/modules/admin/components/ui";
import { getClubDetail, getCoachDetail, type PaymentRow } from "@/modules/admin/queries";
import { requireAdmin } from "@/modules/auth/dal";

export const metadata: Metadata = { title: "Tenant" };

type Params = Promise<{ kind: string; id: string }>;

function Facts({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-px bg-border sm:grid-cols-2">
      {items.map(([label, value]) => (
        <div key={label} className="bg-card px-5 py-3">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="mt-0.5 text-sm font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Payments({ payments }: { payments: PaymentRow[] }) {
  if (payments.length === 0) return <EmptyState>No payments yet.</EmptyState>;
  return (
    <TableWrap>
      <table className="w-full min-w-[560px]">
        <thead className="border-b border-border">
          <tr>
            <th scope="col" className={th}>Date</th>
            <th scope="col" className={th}>Amount</th>
            <th scope="col" className={th}>Platform fee</th>
            <th scope="col" className={th}>Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {payments.map((p) => (
            <tr key={p.id}>
              <td className={`${td} whitespace-nowrap`}>{formatDate(p.paidAt ?? p.createdAt)}</td>
              <td className={`${td} tabular-nums`}>{formatMoney(p.amount, p.currency)}</td>
              <td className={`${td} tabular-nums`}>{formatMoney(p.applicationFeeAmount, p.currency)}</td>
              <td className={td}>
                <span className="flex flex-wrap gap-1">
                  <StatusBadge status={p.status} />
                  {p.disputeStatus !== "NONE" && <StatusBadge status={p.disputeStatus} />}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

function Audit({ entries }: { entries: { id: string; action: string; actorEmail: string; reason: string | null; createdAt: Date }[] }) {
  if (entries.length === 0) return <EmptyState>No admin actions on this tenant.</EmptyState>;
  return (
    <ul className="divide-y divide-border">
      {entries.map((e) => (
        <li key={e.id} className="px-5 py-3 text-sm">
          <span className="font-medium">{e.action.toLowerCase().replaceAll("_", " ")}</span> by {e.actorEmail}
          <span className="block text-xs text-muted-foreground">
            {formatDateTime(e.createdAt)}
            {e.reason && <> · “{e.reason}”</>}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default async function TenantDetailPage({ params }: { params: Params }) {
  await requireAdmin();
  const { kind, id } = await params;
  if ((kind !== "club" && kind !== "coach") || !idSchema.safeParse(id).success) notFound();

  const back = (
    <Link href="/admin/tenants" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-4" aria-hidden /> Tenants
    </Link>
  );

  if (kind === "club") {
    const detail = await getClubDetail(id);
    if (!detail) notFound();
    const { club, subscription, account, counts, payments, audit } = detail;
    return (
      <div className="space-y-6">
        {back}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{club.name}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              Club · /{club.slug} · <StatusBadge status={club.status} />
            </p>
          </div>
          <TenantActions kind="club" id={club.id} name={club.name} suspended={club.status === "SUSPENDED"} showView={false} />
        </div>
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Panel title="Club">
            <Facts
              items={[
                ["Owner", `${club.ownerName ?? "—"} · ${club.ownerEmail}`],
                ["Location", [club.city, club.country].filter(Boolean).join(", ")],
                ["Created", formatDate(club.createdAt)],
                ["Members (athletes)", counts.members],
                ["Coaches & staff", counts.coaches],
                ["Active facilities", counts.facilities],
                ["Sessions (last 30 days)", counts.sessions30],
              ]}
            />
          </Panel>
          <Panel title="Billing">
            <Facts
              items={[
                ["Plan", <TierBadge key="tier" tier={subscription?.tier ?? null} />],
                ["Subscription", subscription ? <StatusBadge key="s" status={subscription.status} /> : "None"],
                ["Pays", subscription ? `${formatMoney(subscription.monthlyAmount, subscription.currency)} / month` : "—"],
                ["Renews", subscription ? `${formatDate(subscription.currentPeriodEnd)}${subscription.cancelAtPeriodEnd ? " (cancels)" : ""}` : "—"],
                ["Stripe Connect", <ConnectBadge key="c" status={account?.status ?? null} chargesEnabled={account?.chargesEnabled ?? null} payoutsEnabled={account?.payoutsEnabled ?? null} />],
                ["Connect account", account?.stripeAccountId ?? "—"],
                ["Requirements due", account?.requirementsDue.length ? account.requirementsDue.join(", ") : "None"],
              ]}
            />
          </Panel>
        </div>
        <Panel title="Recent payments">
          <Payments payments={payments} />
        </Panel>
        <Panel title="Admin history">
          <Audit entries={audit} />
        </Panel>
      </div>
    );
  }

  const detail = await getCoachDetail(id);
  if (!detail) notFound();
  const { coach, subscription, account, counts, payments, audit } = detail;
  const suspended = Boolean(coach.suspendedAt);
  return (
    <div className="space-y-6">
      {back}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{coach.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            Independent coach{coach.handle && <> · @{coach.handle}</>} · <StatusBadge status={suspended ? "SUSPENDED" : "ACTIVE"} />
          </p>
        </div>
        <TenantActions kind="coach" id={coach.id} name={coach.name} suspended={suspended} showView={false} />
      </div>
      {suspended && coach.suspensionReason && (
        <p className="rounded-xl bg-danger-soft p-3 text-sm text-danger">Suspended: “{coach.suspensionReason}”</p>
      )}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel title="Coach">
          <Facts
            items={[
              ["Email", `${coach.email}${coach.emailVerified ? "" : " (unconfirmed)"}`],
              ["Joined", formatDate(coach.createdAt)],
              ["Clubs coached at", counts.clubs],
              ["Sessions (last 30 days)", counts.sessions30],
              ["Sessions (all time)", counts.sessionsTotal],
            ]}
          />
        </Panel>
        <Panel title="Billing">
          <Facts
            items={[
              ["Plan", <TierBadge key="tier" tier={subscription?.tier ?? "FREE_COACH"} />],
              ["Subscription", subscription ? <StatusBadge key="s" status={subscription.status} /> : "Free plan"],
              ["Pays", subscription ? `${formatMoney(subscription.monthlyAmount, subscription.currency)} / month` : "—"],
              ["Stripe Connect", <ConnectBadge key="c" status={account?.status ?? null} chargesEnabled={account?.chargesEnabled ?? null} payoutsEnabled={account?.payoutsEnabled ?? null} />],
              ["Connect account", account?.stripeAccountId ?? "—"],
            ]}
          />
        </Panel>
      </div>
      <Panel title="Recent payments (as coach)">
        <Payments payments={payments} />
      </Panel>
      <Panel title="Admin history">
        <Audit entries={audit} />
      </Panel>
    </div>
  );
}
