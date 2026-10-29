import { AlertTriangle, Banknote, Percent, ShieldAlert, Undo2 } from "lucide-react";
import type { Metadata, Route } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/utils";
import {
  ConnectBadge,
  EmptyState,
  formatDate,
  formatDateTime,
  KpiCard,
  moneyTotals,
  PageHeader,
  Panel,
  StatusBadge,
  TableWrap,
  td,
  th,
} from "@/modules/admin/components/ui";
import { getFinancials, listWebhookEvents } from "@/modules/admin/queries";
import { requireAdmin } from "@/modules/auth/dal";

export const metadata: Metadata = { title: "Financials & Stripe Connect" };

export default async function FinancialsPage() {
  await requireAdmin();
  const [{ fees, feeQueue, disputes, failedTransfers, connectIssues }, { events }] = await Promise.all([
    getFinancials(),
    listWebhookEvents({ q: "", status: "all", page: 1 }),
  ]);
  const totals = (key: "fees30" | "feesAll" | "refunded30" | "disputedOpen") =>
    moneyTotals(fees.map((row) => ({ currency: row.currency, amount: row[key] })));
  const openDisputes = fees.reduce((n, row) => n + row.disputesOpen, 0);

  return (
    <div className="space-y-6">
      <PageHeader title="Financials & Stripe Connect" description="Platform fee earnings, disputes, payout problems and Stripe events." />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Platform fees, last 30 days" icon={<Percent className="size-4" aria-hidden />} value={totals("fees30")} hint={`${totals("feesAll")} all time`} />
        <KpiCard label="Refunded, last 30 days" icon={<Undo2 className="size-4" aria-hidden />} value={totals("refunded30")} />
        <KpiCard label="Open disputes" icon={<ShieldAlert className="size-4" aria-hidden />} value={openDisputes} hint={`${totals("disputedOpen")} at stake`} />
        <KpiCard label="Payout problems" icon={<AlertTriangle className="size-4" aria-hidden />} value={failedTransfers.length + connectIssues.length} hint={`${failedTransfers.length} failed transfers · ${connectIssues.length} accounts need attention`} />
      </div>

      <Panel title="Platform fee queue" action={<span className="text-xs text-muted-foreground">Unsettled payouts first</span>}>
        {feeQueue.length === 0 ? (
          <EmptyState>No paid bookings yet.</EmptyState>
        ) : (
          <TableWrap>
            <table className="w-full min-w-[760px]">
              <thead className="border-b border-border">
                <tr>
                  <th scope="col" className={th}>Paid</th>
                  <th scope="col" className={th}>Club</th>
                  <th scope="col" className={th}>Booking</th>
                  <th scope="col" className={th}>Platform fee</th>
                  <th scope="col" className={th}>Payouts</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {feeQueue.map((p) => (
                  <tr key={p.id}>
                    <td className={`${td} whitespace-nowrap`}>{formatDate(p.paidAt ?? p.createdAt)}</td>
                    <td className={td}>{p.clubName}</td>
                    <td className={`${td} tabular-nums`}>{formatMoney(p.amount, p.currency)}</td>
                    <td className={`${td} tabular-nums font-medium`}>
                      {formatMoney(p.applicationFeeAmount, p.currency)}
                      <span className="ml-1 text-xs text-muted-foreground">({((p.applicationFeeAmount / p.amount) * 100).toFixed(1)}%)</span>
                    </td>
                    <td className={td}>
                      {p.transfersFailed > 0 ? (
                        <Badge variant="danger">{p.transfersFailed} failed</Badge>
                      ) : p.transfersPending > 0 ? (
                        <Badge variant="warning">{p.transfersPending} pending</Badge>
                      ) : (
                        <Badge variant="success">Settled</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel title="Disputed charges">
          {disputes.length === 0 ? (
            <EmptyState>No disputes. Chargebacks appear here as soon as Stripe reports them.</EmptyState>
          ) : (
            <ul className="divide-y divide-border">
              {disputes.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {d.clubName} · {formatMoney(d.disputedAmount ?? d.amount, d.currency)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {d.disputeReason ?? "No reason given"} · {d.stripeDisputeId ?? "no dispute id"} · {formatDate(d.updatedAt)}
                    </p>
                  </div>
                  <StatusBadge status={d.disputeStatus} />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Failed transfers">
          {failedTransfers.length === 0 ? (
            <EmptyState>No failed or reversed transfers.</EmptyState>
          ) : (
            <ul className="divide-y divide-border">
              {failedTransfers.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {t.owner} ({t.recipientType.toLowerCase()}) · {formatMoney(t.amount, t.currency)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t.accountId} · {t.stripeTransferId ?? "no transfer id"} · {formatDate(t.updatedAt)}
                    </p>
                  </div>
                  <StatusBadge status={t.status} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="Connect accounts needing attention">
        {connectIssues.length === 0 ? (
          <EmptyState>Every connected account can charge and pay out.</EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            {connectIssues.map((a) => (
              <li key={a.stripeAccountId}>
                <Link href={a.href as Route} className="flex flex-wrap items-center gap-3 px-5 py-3 hover:bg-muted/60">
                  <Banknote className="size-4 text-muted-foreground" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{a.owner}</p>
                    <p className="text-xs text-muted-foreground">
                      {a.stripeAccountId} · charges {a.chargesEnabled ? "on" : "off"} · payouts {a.payoutsEnabled ? "on" : "off"}
                      {a.requirementsDue.length > 0 && <> · {a.requirementsDue.length} requirements due</>}
                      {a.disabledReason && <> · {a.disabledReason}</>}
                    </p>
                  </div>
                  <ConnectBadge status={a.status} chargesEnabled={a.chargesEnabled} payoutsEnabled={a.payoutsEnabled} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Latest Stripe webhook events" action={<Link href="/admin/logs" className="text-sm font-medium text-accent-text hover:underline">All events</Link>}>
        {events.length === 0 ? (
          <EmptyState>No webhook events received yet.</EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            {events.slice(0, 8).map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <span className="min-w-0 flex-1 font-mono text-xs">{e.type}</span>
                <span className="text-xs text-muted-foreground">{formatDateTime(e.createdAt)}</span>
                {e.error ? <Badge variant="danger">Failed</Badge> : e.processedAt ? <Badge variant="success">Processed</Badge> : <Badge variant="warning">Pending</Badge>}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
