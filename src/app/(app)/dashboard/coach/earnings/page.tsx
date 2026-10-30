import { CircleCheck, CircleX, Hourglass, Landmark, Percent, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";

import { ConnectBadge, EmptyState, formatDate, KpiCard, PageHeader, Pagination, Panel, StatusBadge, TableWrap, td, th } from "@/components/dashboard/ui";
import { parseListParams } from "@/lib/list-params";
import { formatMoney } from "@/lib/utils";
import { kindStyle } from "@/modules/coaching/components/week-timeline";
import { getCoachProfile, requireCoach } from "@/modules/coaching/dal";
import { getCoachConnectAccount, getEarningsByStream, getPayoutTotals, listEarnings } from "@/modules/coaching/queries/earnings";

export const metadata: Metadata = { title: "Earnings & Stripe Connect" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const streams = [
  { kind: "PRIVATE", label: "Direct private sessions" },
  { kind: "GROUP", label: "Club commissions (group classes)" },
  { kind: "OPEN_MATCH", label: "Open match contributions" },
] as const;

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      {ok ? <CircleCheck className="size-4 text-success" aria-hidden /> : <CircleX className="size-4 text-danger" aria-hidden />}
      <span>
        {label}: <span className="font-medium">{ok ? "yes" : "no"}</span>
      </span>
    </li>
  );
}

export default async function EarningsPage({ searchParams }: { searchParams: SearchParams }) {
  const coach = await requireCoach();
  const profile = await getCoachProfile(coach);
  const { page } = parseListParams(await searchParams);
  const [account, byStream, totals, { list, total }] = await Promise.all([
    getCoachConnectAccount(coach.id),
    getEarningsByStream(coach.id),
    getPayoutTotals(coach.id),
    listEarnings(coach.id, page),
  ]);
  const money = (n: number, currency = profile.currency) => formatMoney(n, currency);
  const tz = profile.timezone;

  return (
    <div className="space-y-6">
      <PageHeader title="Earnings & Stripe Connect" description="Your share of every paid session, and the transfers Stripe makes to your account." />

      <Panel title="Stripe Connect account" action={<ConnectBadge status={account?.status ?? null} chargesEnabled={account?.chargesEnabled ?? null} payoutsEnabled={account?.payoutsEnabled ?? null} />}>
        {!account ? (
          <div className="space-y-3 p-5 text-sm">
            <p>No Stripe account connected. Your share of session payments can&apos;t be transferred until you connect one.</p>
            <button type="button" disabled className="h-9 rounded-full bg-ink px-4 text-sm font-semibold text-ink-foreground opacity-50">
              Connect with Stripe
            </button>
            <p className="text-xs text-muted-foreground">Onboarding links are issued by the Stripe Connect integration, which isn&apos;t enabled on this deployment yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 p-5 md:grid-cols-2">
            <ul className="space-y-2">
              <Check ok={account.chargesEnabled} label="Charges enabled" />
              <Check ok={account.payoutsEnabled} label="Payouts enabled" />
              <Check ok={account.detailsSubmitted} label="Details submitted" />
            </ul>
            <div className="min-w-0 text-sm">
              {account.requirementsDue.length === 0 && !account.disabledReason ? (
                <p className="text-success">Nothing outstanding. Stripe pays your share out to your bank.</p>
              ) : (
                <>
                  <p className="font-medium text-danger">Stripe needs more information</p>
                  <ul className="list-inside list-disc text-xs">
                    {account.requirementsDue.map((r) => (
                      <li key={r} className="break-all font-mono">{r}</li>
                    ))}
                  </ul>
                </>
              )}
              <p className="mt-2 font-mono text-xs text-muted-foreground">{account.stripeAccountId}</p>
            </div>
          </div>
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Paid out, last 30 days" icon={<Landmark className="size-4" aria-hidden />} value={money(totals.paid30)} hint="Your transferred share of payments in the last 30 days" />
        <KpiCard label="Awaiting payout" icon={<Hourglass className="size-4" aria-hidden />} value={money(totals.pending)} hint="Pending Stripe transfers" />
        <KpiCard label="Failed transfers" icon={<TriangleAlert className="size-4" aria-hidden />} value={money(totals.failed)} hint={totals.failed > 0 ? "Check your Stripe account details" : "None"} />
        <KpiCard label="Platform fees, last 30 days" icon={<Percent className="size-4" aria-hidden />} value={money(totals.fees30)} hint="Deducted before the split" />
      </div>

      <Panel title="Breakdown by stream">
        <TableWrap>
          <table className="w-full min-w-[640px]">
            <thead className="border-b border-border">
              <tr>
                <th scope="col" className={th}>Stream</th>
                <th scope="col" className={th}>Paid sessions</th>
                <th scope="col" className={th}>Students paid</th>
                <th scope="col" className={th}>Your share, 30 days</th>
                <th scope="col" className={th}>Your share, all time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border tabular-nums">
              {streams.map((st) => {
                const row = byStream.find((r) => r.kind === st.kind);
                return (
                  <tr key={st.kind}>
                    <th scope="row" className={`${td} text-left font-medium`}>
                      <span className="mr-2 inline-block size-2.5 rounded-sm" style={{ background: kindStyle[st.kind].color }} aria-hidden />
                      {st.label}
                    </th>
                    <td className={td}>{row?.sessions ?? 0}</td>
                    <td className={td}>{money(row?.gross ?? 0)}</td>
                    <td className={td}>{money(row?.share30 ?? 0)}</td>
                    <td className={`${td} font-medium`}>
                      {money(row?.share ?? 0)}
                      {(row?.pending ?? 0) > 0 && <span className="block text-xs font-normal text-warning">{money(row!.pending)} pending</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      </Panel>

      <Panel title={`Transaction history (${total})`}>
        {list.length === 0 ? (
          <EmptyState>No paid sessions yet.</EmptyState>
        ) : (
          <TableWrap>
            <table className="w-full min-w-[880px]">
              <thead className="border-b border-border">
                <tr>
                  <th scope="col" className={th}>Date</th>
                  <th scope="col" className={th}>Session</th>
                  <th scope="col" className={th}>Paid</th>
                  <th scope="col" className={th}>Platform fee</th>
                  <th scope="col" className={th}>Card fee</th>
                  <th scope="col" className={th}>Your share</th>
                  <th scope="col" className={th}>Payout</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border tabular-nums">
                {list.map((e) => (
                  <tr key={e.id}>
                    <td className={`${td} whitespace-nowrap`}>{e.paidAt ? formatDate(e.paidAt, tz) : "—"}</td>
                    <td className={td}>
                      <p className="font-medium">{e.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {kindStyle[e.kind].label} · {e.clubName} · {e.student}
                      </p>
                    </td>
                    <td className={td}>
                      {money(e.amount, e.currency)}
                      {e.refundedAmount > 0 && <span className="block text-xs text-danger">−{money(e.refundedAmount, e.currency)} refunded</span>}
                    </td>
                    <td className={td}>{money(e.applicationFeeAmount, e.currency)}</td>
                    <td className={td}>{e.stripeFeeAmount === null ? "—" : money(e.stripeFeeAmount, e.currency)}</td>
                    <td className={`${td} font-medium`}>{e.share === null ? "—" : money(e.share, e.currency)}</td>
                    <td className={td}>
                      {e.shareStatus ? <StatusBadge status={e.shareStatus} /> : <span className="text-xs text-muted-foreground">No coach transfer</span>}
                      {e.stripeTransferId && <span className="block font-mono text-[10px] text-muted-foreground">{e.stripeTransferId}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        <Pagination basePath="/dashboard/coach/earnings" params={{}} page={page} total={total} />
      </Panel>
    </div>
  );
}
