import { and, eq } from "drizzle-orm";
import type { Metadata, Route } from "next";
import Link from "next/link";

import { EmptyState, formatDate, formatTime, PageHeader, Pagination, Panel, StatusBadge, TableWrap, td, th } from "@/components/dashboard/ui";
import { Badge } from "@/components/ui/badge";
import { db } from "@/db";
import { paymentTransaction } from "@/db/schema";
import { parseListParams, pickParam } from "@/lib/list-params";
import { cn, formatMoney } from "@/lib/utils";
import { BookingCard, bookingDay } from "@/modules/student/components/booking-card";
import { RefreshWhile } from "@/modules/student/components/refresh-while";
import { requireStudent } from "@/modules/student/dal";
import { isPassValid, listMyBookings, listMyCreditHistory, listMyPasses, type BookingScope } from "@/modules/student/queries/bookings";
import { loadPolicies } from "@/modules/student/queries/policy";

export const metadata: Metadata = { title: "Bookings & Passes" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const SCOPES = ["upcoming", "past", "cancelled", "all"] as const;
const scopeLabel: Record<BookingScope, string> = { upcoming: "Upcoming", past: "Past", cancelled: "Cancelled", all: "All" };
const kindLabel = { PRIVATE: "Private session", GROUP: "Group clinic", OPEN_MATCH: "Open match" } as const;

export default async function BookingsPage({ searchParams }: { searchParams: SearchParams }) {
  const student = await requireStudent();
  const sp = await searchParams;
  const scope = pickParam(sp.scope, SCOPES, "upcoming");
  const { page } = parseListParams(sp);
  const paymentParam = typeof sp.payment === "string" && /^[a-z0-9]{1,64}$/.test(sp.payment) ? sp.payment : null;

  const [{ list, total }, passes, history, returned] = await Promise.all([
    listMyBookings(student.id, { scope, page }),
    listMyPasses(student.id),
    listMyCreditHistory(student.id),
    sp.checkout === "success" && paymentParam
      ? db.select({ status: paymentTransaction.status, amount: paymentTransaction.amount, currency: paymentTransaction.currency }).from(paymentTransaction).where(and(eq(paymentTransaction.id, paymentParam), eq(paymentTransaction.payerId, student.id)))
      : Promise.resolve([]),
  ]);
  const policyFor = await loadPolicies(list.map((b) => ({ clubId: b.clubId, policyId: b.policyId })));
  const payment = returned[0];
  // The policies behind the bookings listed, one line per club/policy.
  const seen = new Set<string>();
  const policies = list.flatMap((b) => {
    const policy = policyFor(b.clubId, b.policyId);
    const key = `${b.clubId}:${policy.id ?? "default"}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ clubName: b.clubName, policy }];
  });
  const confirming = payment?.status === "REQUIRES_PAYMENT_METHOD";
  const now = Date.now();

  return (
    <div className="space-y-8">
      <PageHeader title="Bookings & passes" description="Every court, lesson and match you've booked, what cancelling would refund, and your session passes." />

      {payment && (
        <p role="status" className={cn("rounded-2xl border px-4 py-3 text-sm", payment.status === "SUCCEEDED" ? "border-success/30 bg-success-soft" : "border-border bg-card")}>
          <RefreshWhile active={confirming} />
          {payment.status === "SUCCEEDED"
            ? `Payment received (${formatMoney(payment.amount, payment.currency)}). You're confirmed.`
            : confirming
              ? "Confirming your payment with Stripe…"
              : "That payment didn't go through."}
        </p>
      )}

      <section aria-labelledby="bookings" className="space-y-3">
        <h2 id="bookings" className="text-lg font-semibold">
          Bookings
        </h2>
        <nav aria-label="Booking filter" className="flex flex-wrap gap-2">
          {SCOPES.map((s) => (
            <Link
              key={s}
              href={`/dashboard/student/bookings?scope=${s}` as Route}
              aria-current={scope === s ? "page" : undefined}
              className={cn("rounded-full px-4 py-1.5 text-sm font-medium", scope === s ? "bg-ink text-ink-foreground" : "text-muted-foreground hover:bg-muted")}
            >
              {scopeLabel[s]}
            </Link>
          ))}
        </nav>
        {list.length === 0 ? (
          <EmptyState>No {scope === "all" ? "" : `${scopeLabel[scope].toLowerCase()} `}bookings.</EmptyState>
        ) : scope === "upcoming" ? (
          <ol className="space-y-3">
            {list.map((b) => (
              <li key={`${b.kind}-${b.id}`}>
                <BookingCard booking={b} policy={policyFor(b.clubId, b.policyId)} />
              </li>
            ))}
          </ol>
        ) : (
          <Panel title={`${total} ${total === 1 ? "booking" : "bookings"}`}>
            <TableWrap>
              <table className="w-full min-w-[720px]">
                <thead className="border-b border-border">
                  <tr>
                    <th scope="col" className={th}>When</th>
                    <th scope="col" className={th}>What</th>
                    <th scope="col" className={th}>Where</th>
                    <th scope="col" className={th}>Paid</th>
                    <th scope="col" className={th}>Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {list.map((b) => (
                    <tr key={`${b.kind}-${b.id}`}>
                      <td className={`${td} whitespace-nowrap tabular-nums`}>
                        {bookingDay(b)} {formatTime(b.startsAt, b.timezone)}
                      </td>
                      <td className={td}>
                        {b.kind === "rental" ? "Court rental" : kindLabel[b.sessionKind!]}
                        <span className="block text-xs text-muted-foreground">
                          {b.kind === "rental" ? b.facilityName : b.title}
                          {b.coachName && ` · ${b.coachName}`}
                        </span>
                      </td>
                      <td className={td}>{b.clubName}</td>
                      <td className={`${td} tabular-nums`}>
                        {b.paymentStatus === "SUCCEEDED" ? formatMoney(b.paymentAmount ?? 0, b.currency) : b.priceAmount > 0 ? "At the club" : "Free"}
                        {(b.refundedAmount ?? 0) > 0 && <span className="block text-xs text-success">{formatMoney(b.refundedAmount!, b.currency)} refunded</span>}
                        {b.refundStatus === "PENDING" && <span className="block text-xs text-warning">Refund processing</span>}
                      </td>
                      <td className={td}>
                        <Badge variant={b.status === "CONFIRMED" ? (b.endsAt.getTime() < now ? "neutral" : "success") : b.status === "PENDING" ? "warning" : "outline"}>
                          {b.status === "CONFIRMED" ? (b.endsAt.getTime() < now ? "Completed" : "Confirmed") : b.status === "PENDING" ? "Pending" : b.cancelledByMe ? "You cancelled" : "Cancelled"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Panel>
        )}
        <Pagination basePath="/dashboard/student/bookings" params={{ scope }} page={page} total={total} />
        {policies.length > 0 && (
          <Panel title="Cancellation policies">
            <ul className="divide-y divide-border text-sm">
              {policies.map(({ clubName, policy }) => (
                <li key={`${clubName}-${policy.name}`} className="px-5 py-3">
                  <p className="font-medium">
                    {clubName} <span className="font-normal text-muted-foreground">· {policy.name}</span>
                  </p>
                  <ul className="mt-1 flex flex-wrap gap-1.5" aria-label={`Refund rules at ${clubName}`}>
                    {[...policy.rules]
                      .sort((a, b) => b.minHoursBeforeStart - a.minHoursBeforeStart)
                      .map((r) => (
                        <li key={r.minHoursBeforeStart}>
                          <Badge variant={r.refundPercent === 100 ? "success" : r.refundPercent > 0 ? "warning" : "outline"}>
                            {r.minHoursBeforeStart > 0 ? `${r.minHoursBeforeStart} h+ before` : "Later"}: {r.refundPercent}%
                          </Badge>
                        </li>
                      ))}
                    <li>
                      <Badge variant="neutral">Club or coach cancels: {policy.organizerCancelRefundPercent}%</Badge>
                    </li>
                  </ul>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </section>

      <section aria-labelledby="passes" className="space-y-3">
        <h2 id="passes" className="text-lg font-semibold">
          Session passes & memberships
        </h2>
        {passes.length === 0 ? (
          <EmptyState>No passes yet. Clubs sell them at the front desk.</EmptyState>
        ) : (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {passes.map((p) => {
              const valid = isPassValid(p, now);
              const left = p.creditsTotal === null ? null : p.creditsTotal - p.creditsUsed;
              const state = p.cancelledAt ? "Cancelled" : p.startsAt.getTime() > now ? "Starts later" : p.expiresAt.getTime() <= now ? "Expired" : left === 0 ? "Used up" : "Active";
              return (
                <li key={p.id} aria-label={`${p.planName} at ${p.clubName}`} className={cn("rounded-2xl border border-border bg-card p-4", !valid && "opacity-70")}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">{p.planName}</p>
                      <p className="text-xs text-muted-foreground">{p.clubName}</p>
                    </div>
                    <Badge variant={state === "Active" ? "success" : "outline"}>{state}</Badge>
                  </div>
                  {left !== null ? (
                    <div className="mt-3">
                      <p className="text-2xl font-semibold tabular-nums">
                        {left}/{p.creditsTotal} <span className="text-sm font-normal text-muted-foreground">sessions left</span>
                      </p>
                      <span className="mt-1 block h-1.5 rounded-full bg-muted" aria-hidden>
                        <span className="block h-full rounded-full bg-chart-1" style={{ width: `${(left / p.creditsTotal!) * 100}%` }} />
                      </span>
                    </div>
                  ) : (
                    <p className="mt-3 text-2xl font-semibold">Unlimited</p>
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">
                    Valid {formatDate(p.startsAt)} → {formatDate(p.expiresAt)}
                    {valid && p.expiresAt.getTime() - now < 7 * 86_400_000 && <span className="text-warning"> · expires soon</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Bought {formatDate(p.paidAt ?? p.createdAt)} · {p.paymentMethod === "COMPLIMENTARY" ? "complimentary" : `${formatMoney(p.priceAmount, p.currency)} ${p.paymentMethod === "ONLINE" ? "online" : "at the desk"}`}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
        {history.length > 0 && (
          <Panel title="Credit history">
            <ul className="divide-y divide-border text-sm">
              {history.map((h) => (
                <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5">
                  <span>
                    <span className={cn("font-medium tabular-nums", h.delta > 0 ? "text-foreground" : "text-success")}>{h.delta > 0 ? "−1" : "+1"}</span> {h.planName} · {h.reason}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(h.createdAt)}
                    {h.actor && ` · ${h.actor}`}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </section>

      <p className="text-xs text-muted-foreground">
        <StatusBadge status="PENDING" /> refunds are on their way: card refunds take 5–10 days to appear.
      </p>
    </div>
  );
}
