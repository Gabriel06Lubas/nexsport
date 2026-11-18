import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { dayLabel, DayPicker } from "@/components/booking/day-picker";
import type { SlotCell } from "@/components/booking/slot-grid";
import { formatTime } from "@/components/dashboard/ui";
import { formatMoney } from "@/lib/utils";
import { getCurrentUser } from "@/modules/auth/dal";
import { clubSlugPattern } from "@/modules/clubs/lib/permissions";
import { zonedParts } from "@/modules/clubs/lib/zoned-time";
import { CoachScheduleGrid } from "@/modules/coaching/components/coach-schedule-grid";
import { buildCoachGrid } from "@/modules/coaching/lib/slot-grid";
import { clubNames, getBookingFor, getPublicCoach, getSlotGrid } from "@/modules/coaching/queries/booking";

// A coach's public booking page: who they are, their rates, and their open
// private sessions as a booking grid (the clubs they teach at as columns,
// start times as rows, one day at a time). Anyone can look; booking needs a
// signed-in account.

type Params = Promise<{ slug: string }>;

async function load(slug: string) {
  if (slug.length > 48 || !clubSlugPattern.test(slug)) return null;
  return getPublicCoach(slug);
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const coach = await load((await params).slug);
  if (!coach) return { title: "Coach not found" };
  return { title: `Book ${coach.name ?? "a coach"}`, description: coach.headline ?? `Book a private ${coach.sportName.toLowerCase()} session.` };
}

const dayFormat = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

export default async function CoachBookingPage({ params, searchParams }: { params: Params; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const coach = await load(slug);
  if (!coach) notFound();
  const [{ open, taken }, viewer] = await Promise.all([getSlotGrid(coach), getCurrentUser()]);
  const sp = await searchParams;
  const bookedParam = sp.booked;
  // Only the student who booked it sees the confirmation details.
  const booked = viewer && typeof bookedParam === "string" ? await getBookingFor(bookedParam, viewer.id, coach.userId) : null;
  const clubs = await clubNames([...new Set([...open, ...taken].map((s) => s.clubId))]);
  const price = Math.round((coach.privateRateAmount * coach.sessionMinutes) / 60);
  const money = (n: number) => formatMoney(n, coach.currency);
  const own = viewer?.id === coach.userId;

  const grid = buildCoachGrid({
    open,
    taken,
    clubs: [...clubs.entries()].map(([id, c]) => ({ id, name: c.city ? `${c.name}, ${c.city}` : c.name, timeZone: c.timezone })).sort((a, b) => a.name.localeCompare(b.name)),
  });
  const requestedDay = typeof sp.day === "string" ? sp.day : undefined;
  const day = requestedDay && grid.days.includes(requestedDay) ? requestedDay : grid.firstOpenDay;
  const priceLabel = money(price);
  const rows = day
    ? grid.rowsFor(day).map((r) => ({
        time: r.time,
        cells: r.cells.map(
          (c): SlotCell =>
            c.state === "available"
              ? { state: "available", startTime: c.startTime, endTime: c.endTime, priceLabel, value: c.startsAt }
              : c.state === "booked"
                ? { state: "booked" }
                : { state: "unavailable", label: "No session at this time" },
        ),
      }))
    : [];
  const signInHref = `/login?callbackUrl=${encodeURIComponent(`/coach/${coach.slug}${day ? `?day=${day}` : ""}`)}` as Route;

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
      <p className="text-sm font-semibold uppercase tracking-wider text-accent-text">{coach.sportName} coach</p>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight">{coach.name ?? "Coach"}</h1>
      {coach.headline && <p className="mt-2 text-lg text-muted-foreground">{coach.headline}</p>}
      {coach.bio && <p className="mt-4 max-w-2xl whitespace-pre-line">{coach.bio}</p>}

      <dl className="mt-6 flex flex-wrap gap-3 text-sm">
        <div className="rounded-2xl border border-border bg-card px-4 py-3">
          <dt className="text-muted-foreground">Private session</dt>
          <dd className="font-semibold">
            {money(price)} · {coach.sessionMinutes} min
          </dd>
        </div>
        {coach.groupRateAmount !== null && (
          <div className="rounded-2xl border border-border bg-card px-4 py-3">
            <dt className="text-muted-foreground">Group sessions</dt>
            <dd className="font-semibold">{money(coach.groupRateAmount)} per person / hour</dd>
          </div>
        )}
      </dl>

      {booked && (
        <div role="status" className="mt-8 rounded-2xl border border-success/30 bg-success-soft px-5 py-4 text-sm">
          <p className="font-semibold">You&apos;re booked with {coach.name ?? "your coach"}.</p>
          <p className="mt-1">
            {dayFormat.format(new Date(`${zonedParts(booked.startsAt, booked.timezone).dateKey}T12:00:00Z`))}, {formatTime(booked.startsAt, booked.timezone)}–
            {formatTime(booked.endsAt, booked.timezone)} at {booked.clubName} · {booked.facilityName}. {formatMoney(booked.priceAmount, booked.currency)}, paid at the club.
          </p>
        </div>
      )}

      <section aria-labelledby="slots" className="mt-10">
        <h2 id="slots" className="text-xl font-semibold">
          Open slots
        </h2>
        {!viewer && (
          <p className="mt-2 text-sm text-muted-foreground">
            <Link href={signInHref} className="font-medium text-accent-text hover:underline">
              Sign in
            </Link>{" "}
            to book a slot.
          </p>
        )}
        {own && <p className="mt-2 text-sm text-muted-foreground">This is your booking page, as students see it.</p>}
        {!day ? (
          <p className="mt-6 rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No open slots right now. Check back soon.
          </p>
        ) : (
          <div className="mt-6 space-y-4">
            <DayPicker days={grid.days} current={day} href={(d) => `/coach/${coach.slug}?day=${d}` as Route} />
            <CoachScheduleGrid
              coachSlug={coach.slug}
              clubs={grid.columns.map((c) => ({ id: c.id, name: c.name }))}
              rows={rows}
              day={day}
              dateLabel={dayLabel(day)}
              sessionMinutes={coach.sessionMinutes}
              mode={own ? "own" : viewer ? "book" : "sign-in"}
              signInHref={signInHref}
            />
          </div>
        )}
        <p className="mt-6 text-xs text-muted-foreground">Times are local to each club. Payment is taken at the club.</p>
      </section>
    </div>
  );
}
