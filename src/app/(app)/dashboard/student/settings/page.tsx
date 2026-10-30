import { eq } from "drizzle-orm";
import { CreditCard, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState, formatDate, PageHeader, Pagination, Panel, StatusBadge, TableWrap, td, th } from "@/components/dashboard/ui";
import { ActionButton, ActionForm, CheckboxField, CheckboxGroup, Field, FormFooter } from "@/components/forms/action-form";
import { db } from "@/db";
import { user } from "@/db/schema";
import { parseListParams } from "@/lib/list-params";
import { formatMoney } from "@/lib/utils";
import { getStripe, listCards } from "@/modules/payments/stripe";
import { openBillingPortal, saveLevels, savePreferences } from "@/modules/student/actions/settings";
import { requireStudent } from "@/modules/student/dal";
import { listMyPayments } from "@/modules/student/queries/bookings";
import { getMyLevels, getMySettings, listSports } from "@/modules/student/queries/matches";

export const metadata: Metadata = { title: "Account & Payments" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

async function savedCards(userId: string) {
  const stripe = getStripe();
  if (!stripe) return { enabled: false as const };
  const [row] = await db.select({ customerId: user.stripeCustomerId }).from(user).where(eq(user.id, userId));
  if (!row?.customerId) return { enabled: true as const, cards: [] };
  try {
    return { enabled: true as const, cards: await listCards(stripe, row.customerId) };
  } catch (error) {
    console.error("[stripe] listing cards failed", error);
    return { enabled: true as const, cards: null };
  }
}

export default async function StudentSettingsPage({ searchParams }: { searchParams: SearchParams }) {
  const student = await requireStudent();
  const { page } = parseListParams(await searchParams);
  const [sports, levels, settings, payments, cards] = await Promise.all([
    listSports(),
    getMyLevels(student.id),
    getMySettings(student.id),
    listMyPayments(student.id, page),
    savedCards(student.id),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="Account & payments" description="Your cards and receipts, your playing level, your clubs and what we email you about." />

      <Panel title="Payment methods">
        {!cards.enabled ? (
          <p className="p-5 text-sm text-muted-foreground">Online payments aren&apos;t enabled on this deployment, so you pay at the club.</p>
        ) : (
          <div className="space-y-4 p-5">
            {cards.cards === null ? (
              <p className="text-sm text-danger">Couldn&apos;t load your saved cards from Stripe. Try again later.</p>
            ) : cards.cards.length === 0 ? (
              <p className="text-sm text-muted-foreground">No saved cards. A card you pay with in checkout can be saved for next time.</p>
            ) : (
              <ul className="space-y-2" aria-label="Saved cards">
                {cards.cards.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 rounded-xl border border-border px-3 py-2 text-sm">
                    <CreditCard className="size-4 text-muted-foreground" aria-hidden />
                    <span className="font-medium capitalize">{c.brand}</span>
                    <span className="tabular-nums">•••• {c.last4}</span>
                    <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                      {String(c.expMonth).padStart(2, "0")}/{c.expYear}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <ActionButton action={openBillingPortal} hidden={{}} variant="primary" pendingLabel="Opening Stripe…">
                Manage payment methods
              </ActionButton>
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <ShieldCheck className="size-3.5" aria-hidden /> Card details are handled by Stripe and never stored by nexport.
              </span>
            </div>
          </div>
        )}
      </Panel>

      <Panel title="Billing history">
        {payments.list.length === 0 ? (
          <EmptyState>No online payments yet.</EmptyState>
        ) : (
          <TableWrap>
            <table className="w-full min-w-[600px]">
              <thead className="border-b border-border">
                <tr>
                  <th scope="col" className={th}>Date</th>
                  <th scope="col" className={th}>For</th>
                  <th scope="col" className={th}>Amount</th>
                  <th scope="col" className={th}>Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {payments.list.map((p) => (
                  <tr key={p.id}>
                    <td className={`${td} whitespace-nowrap`}>{formatDate(p.paidAt ?? p.createdAt)}</td>
                    <td className={td}>{p.description}</td>
                    <td className={`${td} tabular-nums`}>
                      {formatMoney(p.amount, p.currency)}
                      {p.refundedAmount > 0 && <span className="block text-xs text-success">{formatMoney(p.refundedAmount, p.currency)} refunded</span>}
                    </td>
                    <td className={td}>
                      <StatusBadge status={p.refundStatus === "REFUNDED" ? "REFUNDED" : p.refundStatus === "PENDING" ? "PENDING" : p.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        <Pagination basePath="/dashboard/student/settings" params={{}} page={page} total={payments.total} />
      </Panel>

      <Panel title="Playing level">
        <ActionForm action={saveLevels} label="Playing level" className="space-y-4 p-5">
          <p className="text-sm text-muted-foreground">0.0 (just starting) to 10.0 (pro). Open matches are filtered by these.</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {sports.map((s) => (
              <Field key={s.id} name={`level_${s.id}`} label={s.name} defaultValue={levels.get(s.id)?.toFixed(1) ?? ""} inputMode="decimal" placeholder="e.g. 3.5" hint="Blank: not playing" />
            ))}
          </div>
          <FormFooter submit="Save levels" />
        </ActionForm>
      </Panel>

      <Panel title="Clubs & notifications">
        <ActionForm action={savePreferences} label="Clubs and notifications" className="space-y-5 p-5">
          {settings.clubs.length > 0 ? (
            <CheckboxGroup
              name="clubs"
              legend="Preferred clubs"
              options={settings.clubs.map((c) => ({ value: c.id, label: c.city ? `${c.name} (${c.city})` : c.name }))}
              defaultValues={settings.clubs.filter((c) => c.preferred).map((c) => c.id)}
            />
          ) : (
            <p className="text-sm text-muted-foreground">No clubs on nexport yet.</p>
          )}
          <div className="space-y-3">
            <CheckboxField name="matchAlerts" label="Match alerts" hint="Email me when an open match at my level opens at a preferred club" defaultChecked={settings.matchAlerts} />
            <CheckboxField name="bookingUpdates" label="Booking updates" hint="Email me when a booking of mine is changed or cancelled" defaultChecked={settings.bookingUpdates} />
          </div>
          <FormFooter submit="Save preferences" />
        </ActionForm>
      </Panel>

      <p className="text-sm">
        <Link href="/dashboard/settings/security" className="inline-flex items-center gap-2 font-medium hover:underline">
          <ShieldCheck className="size-4" aria-hidden /> Devices and sign-in methods
        </Link>
      </p>
    </div>
  );
}
