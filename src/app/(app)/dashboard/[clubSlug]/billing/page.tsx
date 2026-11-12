import { Landmark, Percent, Receipt, Undo2 } from "lucide-react";
import type { Metadata, Route } from "next";
import Link from "next/link";

import { EmptyState, formatDate, KpiCard, PageHeader, Pagination, Panel, StatusBadge, TableWrap, td, th } from "@/components/dashboard/ui";
import { ActionButton } from "@/components/forms/action-form";
import { Badge } from "@/components/ui/badge";
import { planCurrency, planFactsFor } from "@/config/pricing";
import { parseListParams, pickParam } from "@/lib/list-params";
import { cn, formatMoney } from "@/lib/utils";
import { getClubPlan, requireClubSection } from "@/modules/clubs/dal";
import { openClubBillingPortal, startClubSubscriptionCheckout } from "@/modules/onboarding/actions";
import { ConnectPanel } from "@/modules/payments/components/connect-panel";
import { loadConnectAccount, pendingSharesFor } from "@/modules/payments/connect";
import { openClubStripeDashboard, startClubConnect } from "@/modules/payments/connect-actions";
import { getStripe } from "@/modules/payments/stripe";
import { getMoneyFlow, listTransactions, TX_KINDS, type TxKind } from "@/modules/clubs/queries/billing";

export const metadata: Metadata = { title: "Billing & Stripe Connect" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const kindLabels: Record<TxKind, string> = { all: "All", SESSION: "Coached sessions", COURT_RENTAL: "Court rentals", MEMBERSHIP: "Memberships" };

const planStatusLabels: Record<string, string> = {
  PAST_DUE: "Past due",
  CANCELED: "Cancelled",
  UNPAID: "Unpaid",
  INCOMPLETE: "Incomplete",
  INCOMPLETE_EXPIRED: "Expired",
  PAUSED: "Paused",
};

export default async function BillingPage({ params, searchParams }: { params: Promise<{ clubSlug: string }>; searchParams: SearchParams }) {
  const { clubSlug } = await params;
  const access = await requireClubSection(clubSlug, "billing");
  const { club } = access;
  const sp = await searchParams;
  const kind = pickParam(sp.kind, TX_KINDS, "all");
  const { page } = parseListParams(sp);
  const stripe = getStripe();
  const stripeEnabled = stripe !== null;
  const [plan, account, flow, { txs, total }] = await Promise.all([
    getClubPlan(club.id),
    loadConnectAccount(stripe, { kind: "club", clubId: club.id, slug: club.slug, name: club.name, country: club.country, email: access.user.email }, { justReturned: sp.connect === "return" }),
    getMoneyFlow(club),
    listTransactions(club.id, { kind, page }),
  ]);
  const waiting = account ? await pendingSharesFor(account.id) : null;
  // A subscription that can still be managed in Stripe's portal, vs one that's over and needs a new Checkout.
  const live = plan.status !== null && plan.status !== "CANCELED" && plan.status !== "INCOMPLETE_EXPIRED";
  const owner = access.role === "OWNER";
  const money = (n: number, currency = club.currency) => formatMoney(n, currency);
  const base = `/dashboard/${club.slug}/billing`;

  return (
    <div className="space-y-6">
      <PageHeader title="Billing & Stripe Connect" description="Your connected Stripe account, where each payment's money went, and payouts to your bank." />

      <Panel
        title="nexport plan"
        action={
          plan.status ? (
            <Badge variant={plan.active ? "success" : "danger"}>{plan.active ? (plan.status === "TRIALING" ? "Trial" : "Active") : (planStatusLabels[plan.status] ?? plan.status)}</Badge>
          ) : (
            <Badge variant="danger">No plan</Badge>
          )
        }
      >
        <div className="space-y-4 p-5 text-sm">
          {sp.checkout === "cancelled" && <p role="status" className="rounded-xl bg-muted px-4 py-3">Payment cancelled. Nothing was charged.</p>}
          {plan.active ? (
            <p>
              <span className="font-medium">{plan.planName}</span>: the dashboard, online bookings and every feature in your plan are on.
            </p>
          ) : (
            <p className="text-danger">
              {plan.status
                ? `The ${plan.planName ?? ""} subscription is ${planStatusLabels[plan.status]?.toLowerCase() ?? plan.status.toLowerCase()}, so the dashboard and online bookings are paused.`
                : "This club has no plan, so the dashboard and online bookings are paused."}{" "}
              {live ? "Update the payment method to restore access." : "Choose a plan to restore access."}
            </p>
          )}
          {!owner ? (
            <p className="text-muted-foreground">Only the club owner can change the plan.</p>
          ) : live ? (
            <ActionButton action={openClubBillingPortal} hidden={{ clubSlug: club.slug }} variant="primary" pendingLabel="Opening Stripe…">
              Manage billing
            </ActionButton>
          ) : (
            <div className="flex flex-wrap gap-3">
              {(["CLUB_BASIC", "CLUB_ENTERPRISE"] as const).map((tier) => (
                <ActionButton key={tier} action={startClubSubscriptionCheckout} hidden={{ clubSlug: club.slug, tier }} variant={tier === "CLUB_BASIC" ? "outline" : "primary"} pendingLabel="Opening checkout…">
                  {`Choose ${planFactsFor(tier).name} · ${formatMoney(planFactsFor(tier).monthlyPriceAmount, planCurrency).replace(/\.00$/, "")}/mo`}
                </ActionButton>
              ))}
            </div>
          )}
        </div>
      </Panel>

      <ConnectPanel
        account={account}
        canManage={owner && !access.readOnly}
        enabled={stripeEnabled}
        hidden={{ clubSlug: club.slug }}
        start={startClubConnect}
        dashboard={openClubStripeDashboard}
        who={club.name}
        purpose="Until it is, customers can only pay at the desk: courts can't be booked online and session seats can't be paid online."
        waiting={waiting ? { ...waiting, currency: club.currency } : undefined}
        notice={typeof sp.connect === "string" ? sp.connect : undefined}
        timeZone={club.timezone}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Paid online, last 30 days" icon={<Receipt className="size-4" aria-hidden />} value={money(flow.gross)} hint={`${flow.payments} payments`} />
        <KpiCard label="Platform & card fees" icon={<Percent className="size-4" aria-hidden />} value={money(flow.platformFees + flow.processingFees)} hint={`${money(flow.platformFees)} nexport · ${money(flow.processingFees)} card processing`} />
        <KpiCard label="Paid out to your account" icon={<Landmark className="size-4" aria-hidden />} value={money(flow.toClub)} hint={`${money(flow.clubPending)} pending · ${money(flow.clubFailed)} failed`} />
        <KpiCard label="Refunded" icon={<Undo2 className="size-4" aria-hidden />} value={money(flow.refunded)} hint={`${money(flow.toCoaches)} went to coaches`} />
      </div>

      <nav aria-label="Payment type" className="flex flex-wrap gap-2">
        {TX_KINDS.map((k) => (
          <Link
            key={k}
            href={`${base}?kind=${k}` as Route}
            aria-current={kind === k ? "page" : undefined}
            className={cn("rounded-full px-4 py-1.5 text-sm font-medium", kind === k ? "bg-ink text-ink-foreground" : "text-muted-foreground hover:bg-muted")}
          >
            {kindLabels[k]}
          </Link>
        ))}
      </nav>

      <Panel title={`Transaction history (${total})`}>
        {txs.length === 0 ? (
          <EmptyState>No online payments yet.</EmptyState>
        ) : (
          <TableWrap>
            <table className="w-full min-w-[960px]">
              <thead className="border-b border-border">
                <tr>
                  <th scope="col" className={th}>Date</th>
                  <th scope="col" className={th}>Payment</th>
                  <th scope="col" className={th}>Amount</th>
                  <th scope="col" className={th}>Platform fee</th>
                  <th scope="col" className={th}>Card fee</th>
                  <th scope="col" className={th}>To club</th>
                  <th scope="col" className={th}>To coach</th>
                  <th scope="col" className={th}>Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border tabular-nums">
                {txs.map((t) => (
                  <tr key={t.id}>
                    <td className={`${td} whitespace-nowrap`}>{formatDate(t.paidAt ?? t.createdAt, club.timezone)}</td>
                    <td className={td}>
                      <p className="font-medium">{t.description}</p>
                      <p className="text-xs text-muted-foreground">{t.payer}</p>
                    </td>
                    <td className={td}>
                      {money(t.amount, t.currency)}
                      {t.refundedAmount > 0 && <span className="block text-xs text-danger">−{money(t.refundedAmount, t.currency)} refunded</span>}
                    </td>
                    <td className={td}>{money(t.applicationFeeAmount, t.currency)}</td>
                    <td className={td}>{t.stripeFeeAmount === null ? "—" : money(t.stripeFeeAmount, t.currency)}</td>
                    <td className={td}>
                      {t.clubTransfer === null ? "—" : money(t.clubTransfer, t.currency)}
                      {t.clubTransferStatus && t.clubTransferStatus !== "PAID" && <span className="block"><StatusBadge status={t.clubTransferStatus} /></span>}
                    </td>
                    <td className={td}>
                      {t.coachTransfer === null ? "—" : money(t.coachTransfer, t.currency)}
                      {t.coachTransferStatus && t.coachTransferStatus !== "PAID" && <span className="block"><StatusBadge status={t.coachTransferStatus} /></span>}
                    </td>
                    <td className={td}>
                      <StatusBadge status={t.status} />
                      {t.disputeStatus !== "NONE" && <Badge variant="danger" className="ml-1">Dispute</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        <Pagination basePath={base} params={{ kind }} page={page} total={total} />
      </Panel>
    </div>
  );
}
