import { CalendarCheck, MapPin } from "lucide-react";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { formatTime } from "@/components/dashboard/ui";
import { ActionButton } from "@/components/forms/action-form";
import { ButtonLink } from "@/components/ui/button";
import { formatMoney } from "@/lib/utils";
import { getCurrentUser } from "@/modules/auth/dal";
import { clubSlugPattern } from "@/modules/clubs/lib/permissions";
import { zonedParts } from "@/modules/clubs/lib/zoned-time";
import { bookSlot } from "@/modules/coaching/actions/booking";
import { clubNames, getBookingFor, getOpenSlots, getPublicCoach } from "@/modules/coaching/queries/booking";

// A coach's public booking page: who they are, their rates, and every open
// private slot. Anyone can look; booking needs a signed-in account.

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
  const [slots, viewer] = await Promise.all([getOpenSlots(coach), getCurrentUser()]);
  const bookedParam = (await searchParams).booked;
  // Only the student who booked it sees the confirmation details.
  const booked = viewer && typeof bookedParam === "string" ? await getBookingFor(bookedParam, viewer.id, coach.userId) : null;
  const clubs = await clubNames([...new Set(slots.map((s) => s.clubId))]);
  const price = Math.round((coach.privateRateAmount * coach.sessionMinutes) / 60);
  const money = (n: number) => formatMoney(n, coach.currency);
  const own = viewer?.id === coach.userId;

  // Group by local day at the slot's club.
  const days = new Map<string, typeof slots>();
  for (const s of slots.slice(0, 120)) {
    const tz = clubs.get(s.clubId)?.timezone ?? "UTC";
    const key = zonedParts(s.startsAt, tz).dateKey;
    days.set(key, [...(days.get(key) ?? []), s]);
  }

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
            <Link href={`/login?callbackUrl=${encodeURIComponent(`/coach/${coach.slug}`)}` as Route} className="font-medium text-accent-text hover:underline">
              Sign in
            </Link>{" "}
            to book a slot.
          </p>
        )}
        {own && <p className="mt-2 text-sm text-muted-foreground">This is your booking page, as students see it.</p>}
        {days.size === 0 ? (
          <p className="mt-6 rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No open slots right now. Check back soon.
          </p>
        ) : (
          <ol className="mt-6 space-y-6">
            {[...days.entries()].map(([day, list]) => (
              <li key={day}>
                <h3 className="text-sm font-semibold">{dayFormat.format(new Date(`${day}T12:00:00Z`))}</h3>
                <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {list.map((s) => {
                    const club = clubs.get(s.clubId);
                    const tz = club?.timezone ?? "UTC";
                    return (
                      <li key={`${s.clubId}-${s.startsAt.toISOString()}`} className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3">
                        <span className="min-w-0 text-sm">
                          <span className="flex items-center gap-1.5 font-medium tabular-nums">
                            <CalendarCheck className="size-4 text-muted-foreground" aria-hidden />
                            {formatTime(s.startsAt, tz)}–{formatTime(s.endsAt, tz)}
                          </span>
                          <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                            <MapPin className="size-3.5" aria-hidden />
                            {club?.name}
                            {club?.city && `, ${club.city}`}
                          </span>
                        </span>
                        {viewer && !own ? (
                          <ActionButton action={bookSlot} hidden={{ coachSlug: coach.slug, clubId: s.clubId, startsAt: s.startsAt.toISOString() }} variant="primary" pendingLabel="Booking…">
                            Book
                          </ActionButton>
                        ) : !viewer ? (
                          <ButtonLink href={`/login?callbackUrl=${encodeURIComponent(`/coach/${coach.slug}`)}` as Route} size="sm" variant="outline">
                            Sign in
                          </ButtonLink>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ol>
        )}
        <p className="mt-6 text-xs text-muted-foreground">Times are local to each club. Payment is taken at the club.</p>
      </section>
    </div>
  );
}
