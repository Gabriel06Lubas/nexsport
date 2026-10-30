import { CalendarClock, ChevronLeft, ChevronRight, Hourglass, UserCheck } from "lucide-react";
import type { Metadata, Route } from "next";
import Link from "next/link";

import { EmptyState, formatTime, KpiCard, PageHeader, Panel } from "@/components/dashboard/ui";
import { ActionButton, ActionForm, Field, FormFooter } from "@/components/forms/action-form";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/utils";
import { currentMonth, monthRange } from "@/modules/clubs/queries/staff";
import { addDays, isoDowOf, zonedParts, zonedToUtc } from "@/modules/clubs/lib/zoned-time";
import { addParticipant, cancelSession, completeSession } from "@/modules/coaching/actions/sessions";
import { NewSessionDialog } from "@/modules/coaching/components/new-session-dialog";
import { kindStyle, WeekTimeline, type DayColumn } from "@/modules/coaching/components/week-timeline";
import { getCoachClubs, getCoachProfile, requireCoach } from "@/modules/coaching/dal";
import { getCoachKpis, getCoachSessions, getSessionFormOptions, getSessionsToWrapUp, type CoachSession } from "@/modules/coaching/queries/schedule";

export const metadata: Metadata = { title: "Schedule & Sessions" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const dayFormat = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const dayLabel = (dateKey: string) => dayFormat.format(new Date(`${dateKey}T12:00:00Z`));
const hours = (n: number) => `${n.toLocaleString("en", { maximumFractionDigits: 1 })} h`;

export default async function CoachSchedulePage({ searchParams }: { searchParams: SearchParams }) {
  const coach = await requireCoach();
  const profile = await getCoachProfile(coach);
  const tz = profile.timezone;
  const today = zonedParts(new Date(), tz).dateKey;
  const raw = (await searchParams).week;
  const anchor = typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw) && zonedToUtc(raw, 0, tz) ? raw : today;
  const monday = addDays(anchor, 1 - isoDowOf(anchor));
  const weekFrom = zonedToUtc(monday, 0, tz)!;
  const weekTo = zonedToUtc(addDays(monday, 7), 0, tz)!;
  const thisMonday = addDays(today, 1 - isoDowOf(today));
  const month = monthRange(currentMonth(tz), tz);
  const upcomingTo = new Date(Date.now() + 14 * 86_400_000);

  const clubs = await getCoachClubs(coach.id);
  const [kpis, week, upcoming, wrapUp, options] = await Promise.all([
    getCoachKpis(coach.id, {
      weekFrom: zonedToUtc(thisMonday, 0, tz)!,
      weekTo: zonedToUtc(addDays(thisMonday, 7), 0, tz)!,
      monthFrom: month.from,
      monthTo: month.to,
    }),
    getCoachSessions(coach.id, weekFrom, weekTo),
    getCoachSessions(coach.id, new Date(), upcomingTo),
    getSessionsToWrapUp(coach.id),
    getSessionFormOptions(clubs.filter((c) => c.status !== "SUSPENDED").map((c) => c.clubId)),
  ]);

  const days: DayColumn[] = Array.from({ length: 7 }, (_, i) => {
    const dateKey = addDays(monday, i);
    return { dateKey, label: dayLabel(dateKey), sessions: [] };
  });
  let fromHour = 7;
  let toHour = 22;
  for (const s of week) {
    const start = zonedParts(s.startsAt, tz);
    const day = days.find((d) => d.dateKey === start.dateKey);
    if (!day) continue;
    const endMinute = start.minuteOfDay + Math.round((s.endsAt.getTime() - s.startsAt.getTime()) / 60_000);
    day.sessions.push({ ...s, startMinute: start.minuteOfDay, endMinute });
    fromHour = Math.min(fromHour, Math.floor(start.minuteOfDay / 60));
    toHour = Math.max(toHour, Math.min(24, Math.ceil(endMinute / 60)));
  }
  const upcomingLive = upcoming.filter((s) => s.status !== "CANCELLED" && s.startsAt.getTime() > Date.now());

  return (
    <div className="space-y-6">
      <PageHeader title="Schedule & sessions" description={`Your private sessions, group classes and open matches. Times in ${tz}.`}>
        <NewSessionDialog facilities={options.facilities} sports={options.sports} equipment={options.equipment} defaultDate={today} defaultSportId={profile.sportId} />
      </PageHeader>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard
          label="Hours scheduled"
          icon={<CalendarClock className="size-4" aria-hidden />}
          value={`${hours(kpis.weekHours)} this week`}
          hint={`${hours(kpis.monthHours)} this month · ${kpis.weekSessions} sessions this week`}
        />
        <KpiCard
          label="Pending session earnings"
          icon={<Hourglass className="size-4" aria-hidden />}
          value={formatMoney(kpis.pending, profile.currency)}
          hint={`${kpis.pendingCount} Stripe ${kpis.pendingCount === 1 ? "transfer" : "transfers"} awaiting payout`}
        />
        <KpiCard
          label="Average attendance rate"
          icon={<UserCheck className="size-4" aria-hidden />}
          value={kpis.attendanceRate === null ? "—" : `${(kpis.attendanceRate * 100).toFixed(0)}%`}
          hint={kpis.marked ? `${kpis.attended} of ${kpis.marked} check-ins, last 90 days` : "Mark attendance to see your rate"}
        />
      </div>

      <Panel
        title={`Week of ${dayLabel(monday)}`}
        action={
          <nav aria-label="Week" className="flex items-center gap-1">
            <Link href={`/dashboard/coach?week=${addDays(monday, -7)}` as Route} aria-label="Previous week" className="inline-flex size-8 items-center justify-center rounded-full border border-border hover:bg-muted">
              <ChevronLeft className="size-4" aria-hidden />
            </Link>
            {monday !== thisMonday && (
              <Link href="/dashboard/coach" className="rounded-full border border-border px-3 py-1 text-xs font-medium hover:bg-muted">
                This week
              </Link>
            )}
            <Link href={`/dashboard/coach?week=${addDays(monday, 7)}` as Route} aria-label="Next week" className="inline-flex size-8 items-center justify-center rounded-full border border-border hover:bg-muted">
              <ChevronRight className="size-4" aria-hidden />
            </Link>
          </nav>
        }
      >
        <WeekTimeline days={days} fromHour={fromHour} toHour={toHour} todayKey={today} />
      </Panel>

      {wrapUp.length > 0 && (
        <Panel title={`To wrap up (${wrapUp.length})`} action={<Link href="/dashboard/coach/students" className="text-sm font-medium text-accent-text hover:underline">Take attendance</Link>}>
          <ul className="divide-y divide-border">
            {wrapUp.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{s.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {dayLabel(zonedParts(s.startsAt, tz).dateKey)} {formatTime(s.startsAt, tz)} · {s.clubName} · attendance {s.marked}/{s.participants}
                  </p>
                </div>
                <ActionButton action={completeSession} hidden={{ sessionId: s.id }} variant="primary">
                  Mark completed
                </ActionButton>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title="Next 14 days">
        {upcomingLive.length === 0 ? (
          <EmptyState>Nothing booked in the next two weeks.</EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            {upcomingLive.map((s) => (
              <UpcomingRow key={s.id} session={s} tz={tz} />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function UpcomingRow({ session: s, tz }: { session: CoachSession; tz: string }) {
  const full = s.maxParticipants !== null && s.participants >= s.maxParticipants;
  return (
    <li id={`session-${s.id}`} className="scroll-mt-24 space-y-2 px-5 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm">
            <span className="font-medium tabular-nums">
              {dayLabel(zonedParts(s.startsAt, tz).dateKey)} {formatTime(s.startsAt, tz)}–{formatTime(s.endsAt, tz)}
            </span>{" "}
            <Badge variant="outline">
              <span className="mr-1 inline-block size-2 rounded-sm" style={{ background: kindStyle[s.kind].color }} aria-hidden />
              {kindStyle[s.kind].label}
            </Badge>
          </p>
          <p className="mt-0.5 text-sm font-medium">{s.title}</p>
          <p className="text-xs text-muted-foreground">
            {s.clubName} · {s.facilityName} · {s.participants}/{s.maxParticipants ?? "∞"} students
            {s.priceAmount > 0 && <> · {formatMoney(s.priceAmount, s.currency)} each</>}
            {s.students && <> · {s.students}</>}
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          {!full && (
            <details>
              <summary className="cursor-pointer whitespace-nowrap rounded-full border border-border px-3 py-1.5 text-xs font-semibold">Add student</summary>
              <ActionForm action={addParticipant} hidden={{ sessionId: s.id }} label={`Add a student to ${s.title}`} className="mt-2 w-[min(80vw,18rem)] space-y-2">
                <Field name="email" label="Student email" type="email" autoComplete="off" />
                <FormFooter submit="Add" pendingLabel="Adding…" />
              </ActionForm>
            </details>
          )}
          <details>
            <summary className="cursor-pointer whitespace-nowrap rounded-full border border-border px-3 py-1.5 text-xs font-semibold">Cancel</summary>
            <ActionForm action={cancelSession} hidden={{ sessionId: s.id }} label={`Cancel ${s.title}`} className="mt-2 w-[min(80vw,18rem)] space-y-2">
              <Field name="reason" label="Reason" maxLength={200} placeholder="Coach unwell" />
              <FormFooter submit="Cancel session" pendingLabel="Cancelling…" />
            </ActionForm>
          </details>
        </div>
      </div>
    </li>
  );
}
