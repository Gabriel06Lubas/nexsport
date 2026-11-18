import type { Metadata, Route } from "next";
import Link from "next/link";

import { dayLabel, DayPicker } from "@/components/booking/day-picker";
import type { SlotCell } from "@/components/booking/slot-grid";
import { PageHeader, Panel } from "@/components/dashboard/ui";
import { cn, formatMoney } from "@/lib/utils";
import { idSchema } from "@/lib/validation";
import { CourtScheduleGrid } from "@/modules/billing/components/court-schedule-grid";
import { MAX_ADVANCE_DAYS } from "@/modules/billing/lib/court-booking";
import { buildCourtGrid, GRID_DURATIONS, moneyLocale, parseGridDuration, type GridCell } from "@/modules/billing/lib/court-grid";
import { getCourtGridData, listBookableClubs } from "@/modules/billing/queries/court-booking";
import { addDays, zonedParts } from "@/modules/clubs/lib/zoned-time";
import { releaseExpiredHolds } from "@/modules/payments/settle";
import { getStripe } from "@/modules/payments/stripe";
import { requireStudent } from "@/modules/student/dal";

export const metadata: Metadata = { title: "Book a court" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

const unavailableLabel: Record<Extract<GridCell, { state: "unavailable" }>["reason"], string> = {
  closed: "Closed",
  past: "No longer bookable",
  "no-fit": "Not long enough before the next booking or closing",
  desk: "Book at the front desk",
};

export default async function BookCourtPage({ searchParams }: { searchParams: SearchParams }) {
  await requireStudent();
  const sp = await searchParams;

  if (!getStripe()) {
    return (
      <div className="space-y-6">
        <PageHeader title="Book a court" />
        <p className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">
          Online booking isn&apos;t available on this deployment. Book at the club&apos;s front desk.
        </p>
      </div>
    );
  }

  // Lapsed holds would otherwise show as booked until something else swept them.
  await releaseExpiredHolds();
  const clubs = await listBookableClubs();
  const requestedClub = one(sp.club);
  const current = clubs.find((c) => idSchema.safeParse(requestedClub).success && c.clubId === requestedClub) ?? clubs[0];

  if (!current) {
    return (
      <div className="space-y-6">
        <PageHeader title="Book a court" />
        <p className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">No club takes online bookings yet.</p>
      </div>
    );
  }

  const today = zonedParts(new Date(), current.timezone).dateKey;
  const last = addDays(today, MAX_ADVANCE_DAYS);
  const requestedDate = one(sp.date);
  const date = requestedDate && DATE.test(requestedDate) && requestedDate >= today && requestedDate <= last ? requestedDate : today;
  const duration = parseGridDuration(one(sp.d));

  const data = await getCourtGridData(current.clubId, date);
  const locale = moneyLocale(data?.club.country ?? "");
  const grid = data
    ? buildCourtGrid({
        date,
        timeZone: data.club.timezone,
        duration,
        courts: data.courts,
        busy: data.busy,
      })
    : [];
  const rows = grid.map((r) => ({
    time: r.time,
    cells: r.cells.map(
      (c): SlotCell =>
        c.state === "available"
          ? {
              state: "available",
              startTime: c.startTime,
              endTime: c.endTime,
              priceLabel: formatMoney(c.amount, data!.club.currency, locale),
            }
          : c.state === "booked"
            ? { state: "booked" }
            : { state: "unavailable", label: unavailableLabel[c.reason] },
    ),
  }));

  const href = (over: { club?: string; date?: string; d?: number }) =>
    `/dashboard/student/book?${new URLSearchParams({ club: over.club ?? current.clubId, date: over.date ?? date, d: String(over.d ?? duration) })}` as Route;
  const days = Array.from({ length: 7 }, (_, i) => addDays(date <= addDays(today, 3) ? today : addDays(date, -3), i)).filter((d) => d <= last);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Book a court"
        description="Pick a court and a start time. The court is held for 15 minutes while you pay with Stripe; the price follows the club's peak and off-peak rates."
      />

      {one(sp.checkout) === "cancelled" && (
        <p role="status" className="rounded-xl border border-border bg-muted/50 px-4 py-3 text-sm">
          Payment cancelled. The court stays held for a few minutes: pay or release it from{" "}
          <Link href="/dashboard/student/bookings" className="font-medium underline underline-offset-2">
            Bookings
          </Link>
          .
        </p>
      )}

      <Panel
        title={data?.club.name ?? current.clubName}
        action={
          // A plain GET form: works before (and without) JavaScript.
          <form method="get" aria-label="Club" className="flex items-center gap-2">
            <input type="hidden" name="date" value={date} />
            <input type="hidden" name="d" value={duration} />
            <label className="sr-only" htmlFor="club">
              Club
            </label>
            <select id="club" name="club" defaultValue={current.clubId} className="h-9 max-w-48 rounded-full border border-border bg-background px-3 text-sm">
              {clubs.map((c) => (
                <option key={c.clubId} value={c.clubId}>
                  {c.clubName}
                  {c.city ? ` · ${c.city}` : ""}
                </option>
              ))}
            </select>
            <button className="h-9 rounded-full bg-ink px-3 text-xs font-semibold text-ink-foreground">Show</button>
          </form>
        }
      >
        <div className="space-y-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <DayPicker days={days} current={date} href={(d) => href({ date: d })} />
            <nav aria-label="Booking length" className="flex rounded-full border border-border bg-background p-0.5 text-xs">
              {GRID_DURATIONS.map((d) => (
                <Link
                  key={d}
                  href={href({ d })}
                  aria-current={d === duration ? "true" : undefined}
                  className={cn("rounded-full px-3 py-1.5 font-medium transition", d === duration ? "bg-ink text-ink-foreground" : "text-muted-foreground hover:text-foreground")}
                >
                  {d === 60 ? "1 h" : d === 90 ? "1 h 30" : "2 h"}
                </Link>
              ))}
            </nav>
          </div>

          <CourtScheduleGrid
            courts={data?.courts.map((c) => ({ id: c.id, name: c.name })) ?? []}
            rows={rows}
            date={date}
            dateLabel={dayLabel(date)}
            duration={duration}
          />
        </div>
      </Panel>
    </div>
  );
}
