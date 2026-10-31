import { and, eq, gt, sql } from "drizzle-orm";
import type { Metadata } from "next";

import { PageHeader, Panel } from "@/components/dashboard/ui";
import { db } from "@/db";
import { facilityBooking, paymentTransaction } from "@/db/schema";
import { formatMoney } from "@/lib/utils";
import { CourtBookingForm } from "@/modules/billing/components/court-booking-form";
import { PaymentStep } from "@/modules/billing/components/payment-step";
import { listBookableFacilities } from "@/modules/billing/queries/court-booking";
import { minuteToTime, zonedParts } from "@/modules/clubs/lib/zoned-time";
import { getStripe } from "@/modules/payments/stripe";
import { requireStudent } from "@/modules/student/dal";

export const metadata: Metadata = { title: "Book a court" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function BookCourtPage({ searchParams }: { searchParams: SearchParams }) {
  const student = await requireStudent();
  const stripe = getStripe();
  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim();
  const resume = (await searchParams).resume;

  if (!stripe || !publishableKey) {
    return (
      <div className="space-y-6">
        <PageHeader title="Book a court" />
        <p className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">Online booking isn&apos;t available on this deployment. Book at the club&apos;s front desk.</p>
      </div>
    );
  }

  // Coming back to pay for a court already held.
  if (typeof resume === "string" && /^[a-z0-9]{1,64}$/.test(resume)) {
    const [held] = await db
      .select({ intentId: paymentTransaction.stripePaymentIntentId, amount: paymentTransaction.amount, currency: paymentTransaction.currency, until: paymentTransaction.checkoutExpiresAt, bookingId: facilityBooking.id })
      .from(paymentTransaction)
      .innerJoin(facilityBooking, eq(facilityBooking.id, paymentTransaction.facilityBookingId))
      .where(
        and(
          eq(paymentTransaction.id, resume),
          eq(paymentTransaction.payerId, student.id),
          eq(paymentTransaction.kind, "COURT_RENTAL"),
          eq(paymentTransaction.status, "REQUIRES_PAYMENT_METHOD"),
          gt(paymentTransaction.checkoutExpiresAt, sql`now()`),
          eq(facilityBooking.status, "PENDING"),
        ),
      );
    const intent = held?.intentId ? await stripe.paymentIntents.retrieve(held.intentId).catch(() => null) : null;
    return (
      <div className="space-y-6">
        <PageHeader title="Pay for your court" />
        <Panel title="Payment">
          <div className="p-5">
            {held && intent?.client_secret ? (
              <PaymentStep
                publishableKey={publishableKey}
                clientSecret={intent.client_secret}
                returnPath={`/dashboard/student/bookings?booking=${held.bookingId}`}
                amountLabel={formatMoney(held.amount, held.currency)}
                holdExpiresAt={held.until!.toISOString()}
              />
            ) : (
              <p className="text-sm text-muted-foreground">This hold has expired or was already paid. Check your bookings.</p>
            )}
          </div>
        </Panel>
      </div>
    );
  }

  const facilities = await listBookableFacilities();
  const today = zonedParts(new Date(), facilities[0]?.timezone ?? "UTC").dateKey;
  return (
    <div className="space-y-6">
      <PageHeader title="Book a court" description="Pick a court and a time. You pay online and it's yours; the price follows the club's peak and off-peak rates." />
      <Panel title="Court and time">
        <div className="p-5">
          {facilities.length === 0 ? (
            <p className="text-sm text-muted-foreground">No club takes online bookings yet.</p>
          ) : (
            <CourtBookingForm
              publishableKey={publishableKey}
              defaultDate={today}
              facilities={facilities.map((f) => ({
                facilityId: f.facilityId,
                label: `${f.clubName} · ${f.facilityName} (${minuteToTime(f.openMinute)}–${minuteToTime(f.closeMinute)}${f.rate !== null ? `, from ${formatMoney(f.rate, f.currency)}/h` : ""})`,
              }))}
            />
          )}
        </div>
      </Panel>
    </div>
  );
}
