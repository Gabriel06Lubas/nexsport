import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Metadata, Route } from "next";
import Link from "next/link";

import { EmptyState, formatTime, PageHeader, Panel } from "@/components/dashboard/ui";
import { ActionButton, ActionForm, CheckboxField, Field, FormFooter, SelectField } from "@/components/forms/action-form";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/utils";
import { cancelBooking, createBooking, markBookingPaid } from "@/modules/clubs/actions/schedule";
import { requireClubSection } from "@/modules/clubs/dal";
import { releaseExpiredHolds } from "@/modules/payments/settle";
import { listFacilities } from "@/modules/clubs/queries/facilities";
import { getSchedule, type ScheduleItem } from "@/modules/clubs/queries/schedule";
import { addDays, zonedParts, zonedToUtc } from "@/modules/clubs/lib/zoned-time";

export const metadata: Metadata = { title: "Bookings & Schedule" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const dayTitle = (dateKey: string) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${dateKey}T12:00:00Z`));

export default async function SchedulePage({ params, searchParams }: { params: Promise<{ clubSlug: string }>; searchParams: SearchParams }) {
  const { clubSlug } = await params;
  const access = await requireClubSection(clubSlug, "schedule");
  const { club } = access;
  const tz = club.timezone;
  const today = zonedParts(new Date(), tz).dateKey;
  const raw = (await searchParams).date;
  // Only a real calendar date is accepted; anything else shows today.
  const date = typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw) && zonedToUtc(raw, 0, tz) ? raw : today;
  const from = zonedToUtc(date, 0, tz)!;
  const to = zonedToUtc(addDays(date, 1), 0, tz)!;

  // Free courts held by online payments that were never completed.
  await releaseExpiredHolds();
  const [facilities, items] = await Promise.all([listFacilities(club.id), getSchedule(club.id, from, to)]);
  const active = facilities.filter((f) => f.isActive);
  const base = `/dashboard/${club.slug}/schedule`;
  const dayLink = (d: string) => `${base}?date=${d}` as Route;
  const money = (n: number) => formatMoney(n, club.currency);
  const writable = !access.readOnly;

  return (
    <div className="space-y-6">
      <PageHeader title="Bookings & schedule" description={`Court rentals and coached sessions. Times in ${tz}.`} />

      <nav aria-label="Day" className="flex flex-wrap items-center gap-2">
        <Link href={dayLink(addDays(date, -1))} className="inline-flex size-9 items-center justify-center rounded-full border border-border hover:bg-muted" aria-label="Previous day">
          <ChevronLeft className="size-4" aria-hidden />
        </Link>
        <h2 className="min-w-0 px-2 text-base font-semibold">{dayTitle(date)}</h2>
        <Link href={dayLink(addDays(date, 1))} className="inline-flex size-9 items-center justify-center rounded-full border border-border hover:bg-muted" aria-label="Next day">
          <ChevronRight className="size-4" aria-hidden />
        </Link>
        {date !== today && (
          <Link href={dayLink(today)} className="rounded-full border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted">
            Today
          </Link>
        )}
      </nav>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-4">
          {active.length === 0 && <EmptyState>No active facilities. Add one under Facilities & Courts.</EmptyState>}
          {active.map((f) => {
            const day = items.filter((i) => i.facilityId === f.id);
            return (
              <Panel key={f.id} title={f.name} action={<span className="text-xs text-muted-foreground">{day.filter((i) => i.status !== "CANCELLED").length} bookings</span>}>
                {day.length === 0 ? (
                  <EmptyState>Free all day.</EmptyState>
                ) : (
                  <ul className="divide-y divide-border">
                    {day.map((item) => (
                      <BookingRow key={`${item.kind}-${item.id}`} item={item} tz={tz} money={money} slug={club.slug} writable={writable} />
                    ))}
                  </ul>
                )}
              </Panel>
            );
          })}
        </div>

        {writable && active.length > 0 && (
          <Panel title="New court booking" className="xl:sticky xl:top-24 xl:self-start">
            <ActionForm action={createBooking} hidden={{ clubSlug: club.slug }} label="New court booking" className="space-y-3 p-5">
              <SelectField name="facilityId" label="Facility" options={active.map((f) => ({ value: f.id, label: f.name }))} />
              <Field name="date" label="Date" type="date" defaultValue={date} min={today} />
              <div className="grid grid-cols-2 gap-3">
                <Field name="startTime" label="From" type="time" step={900} defaultValue="18:00" />
                <Field name="endTime" label="Until" type="time" step={900} defaultValue="19:30" />
              </div>
              <Field name="customerEmail" label="Customer email" type="email" autoComplete="off" hint="For a nexport member" />
              <Field name="customerName" label="Or walk-in name" maxLength={80} />
              <SelectField
                name="paymentMethod"
                label="Payment"
                options={[
                  { value: "ON_SITE", label: "Pay at the desk" },
                  { value: "COMPLIMENTARY", label: "Complimentary" },
                ]}
              />
              <CheckboxField name="paidNow" label="Paid now" hint="Leave unticked to collect on arrival" />
              <Field name="notes" label="Note" maxLength={300} hint="Optional" />
              <p className="text-xs text-muted-foreground">The price comes from the facility&apos;s standard, peak and off-peak rates.</p>
              <FormFooter submit="Book" pendingLabel="Booking…" />
            </ActionForm>
          </Panel>
        )}
      </div>
    </div>
  );
}

function BookingRow({ item, tz, money, slug, writable }: { item: ScheduleItem; tz: string; money: (n: number) => string; slug: string; writable: boolean }) {
  const cancelled = item.status === "CANCELLED";
  const upcoming = item.endsAt.getTime() > Date.now();
  return (
    <li className={`flex flex-wrap items-start justify-between gap-3 px-5 py-3 ${cancelled ? "opacity-60" : ""}`}>
      <div className="min-w-0">
        <p className="text-sm">
          <span className="font-medium tabular-nums">
            {formatTime(item.startsAt, tz)}–{formatTime(item.endsAt, tz)}
          </span>{" "}
          <Badge variant={item.kind === "session" ? "neutral" : "lime"}>{item.kind === "session" ? "Coached session" : "Court rental"}</Badge>
          {cancelled && <Badge variant="outline" className="ml-1">Cancelled</Badge>}
          {item.status === "PENDING" && <Badge variant="warning" className="ml-1">Payment pending</Badge>}
        </p>
        <p className="mt-0.5 text-sm">{item.title}</p>
        <p className="text-xs text-muted-foreground">
          {item.kind === "session" ? <>Coach {item.detail}</> : item.detail}
          {item.kind === "rental" && (
            <>
              {item.detail && " · "}
              {money(item.priceAmount)} ·{" "}
              {item.status === "PENDING"
                ? "held, awaiting online payment"
                : item.paymentMethod === "COMPLIMENTARY"
                  ? "complimentary"
                  : item.paymentMethod === "ONLINE"
                    ? "paid online"
                    : item.paidAt
                      ? "paid at desk"
                      : "to collect"}
            </>
          )}
        </p>
      </div>
      {writable && item.kind === "rental" && !cancelled && (
        <div className="flex flex-wrap items-start gap-2">
          {item.paymentMethod === "ON_SITE" && !item.paidAt && (
            <ActionButton action={markBookingPaid} hidden={{ clubSlug: slug, bookingId: item.id }}>
              Mark paid
            </ActionButton>
          )}
          {upcoming && item.paymentMethod !== "ONLINE" && (
            <details>
              <summary className="cursor-pointer rounded-full border border-border px-3 py-1.5 text-xs font-semibold">Cancel</summary>
              <ActionForm action={cancelBooking} hidden={{ clubSlug: slug, bookingId: item.id }} label="Cancel booking" className="mt-2 w-[min(80vw,18rem)] space-y-2">
                <Field name="reason" label="Reason" maxLength={200} placeholder="Customer called to cancel" />
                <FormFooter submit="Cancel booking" pendingLabel="Cancelling…" />
              </ActionForm>
            </details>
          )}
        </div>
      )}
    </li>
  );
}
