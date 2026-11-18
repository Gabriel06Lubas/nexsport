import { ArrowLeft, CalendarPlus, Clock, Mail, MapPin, MessageCircle, Navigation, Phone, Users } from "lucide-react";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { formatTime, Panel } from "@/components/dashboard/ui";
import { ActionButton, ActionForm, Field, FormFooter, SelectField } from "@/components/forms/action-form";
import { Badge } from "@/components/ui/badge";
import { directionsUrl } from "@/lib/maps";
import { cn, formatMoney } from "@/lib/utils";
import { idSchema } from "@/lib/validation";
import { zonedParts } from "@/modules/clubs/lib/zoned-time";
import { markAttendance, saveFeedback } from "@/modules/coaching/actions/students";
import { addParticipant, cancelSession, completeSession } from "@/modules/coaching/actions/sessions";
import { kindStyle } from "@/modules/coaching/components/week-timeline";
import { requireCoach } from "@/modules/coaching/dal";
import { CHECK_IN_MINUTES, checkInOpen, historyLabel, initials, mailtoAll, sessionTiming, whatsappUrl } from "@/modules/coaching/lib/session-detail";
import { getCoachSessionDetail, type CoachSessionDetail, type SessionAthlete } from "@/modules/coaching/queries/schedule";
import { formatPhone } from "@/modules/profile/lib/personal";

// One session, for the coach who runs it: when and where (with directions
// and an Add to calendar file), who's coming (level, history with the coach,
// payment, and one tap to call, WhatsApp or email them), check-in and a
// private note per athlete, and what can still be done (add a student,
// complete, cancel). Built for a phone at the court as much as a desk.

type Params = Promise<{ id: string }>;

export const metadata: Metadata = { title: "Session" };

const longDay = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const shortDay = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const dayOf = (d: Date, tz: string, f: Intl.DateTimeFormat) => f.format(new Date(`${zonedParts(d, tz).dateKey}T12:00:00Z`));

const statusBadge = {
  DRAFT: { label: "Draft", variant: "neutral" },
  SCHEDULED: null,
  IN_PROGRESS: { label: "In progress", variant: "warning" },
  COMPLETED: { label: "Completed", variant: "success" },
  CANCELLED: { label: "Cancelled", variant: "danger" },
} as const;

const attendanceButtons = [
  { status: "PRESENT", label: "Present" },
  { status: "LATE", label: "Late" },
  { status: "ABSENT", label: "Absent" },
] as const;

export default async function CoachSessionPage({ params }: { params: Params }) {
  const coach = await requireCoach();
  const { id } = await params;
  if (!idSchema.safeParse(id).success) notFound();
  const s = await getCoachSessionDetail(coach.id, id);
  if (!s) notFound();

  const tz = s.clubTimezone;
  const now = new Date();
  const timing = sessionTiming(s.startsAt, s.endsAt, now);
  const minutes = Math.round((s.endsAt.getTime() - s.startsAt.getTime()) / 60_000);
  const when = `${dayOf(s.startsAt, tz, longDay)} · ${formatTime(s.startsAt, tz)}–${formatTime(s.endsAt, tz)}`;
  const going = s.athletes.filter((a) => a.status === "ACCEPTED");
  const waiting = s.athletes.filter((a) => a.status !== "ACCEPTED");
  const open = s.status === "SCHEDULED" || s.status === "IN_PROGRESS";
  const upcoming = s.status === "SCHEDULED" && timing.phase !== "live" && timing.phase !== "ended";
  const started = open && now >= s.startsAt;
  const full = s.maxParticipants !== null && going.length >= s.maxParticipants;
  const money = (n: number) => formatMoney(n, s.currency);
  const expected = s.priceAmount * going.length;
  const paidOnline = going.reduce((sum, a) => sum + (a.paymentStatus === "SUCCEEDED" ? (a.paymentAmount ?? 0) : 0), 0);
  const address = [s.addressLine1, s.postalCode && s.city ? `${s.postalCode} ${s.city}` : s.city].filter(Boolean).join(", ");
  const directions = directionsUrl([s.clubName, s.addressLine1, s.city, s.country]);
  const message = (a: SessionAthlete) =>
    `Hi ${(a.name ?? "").split(" ")[0] || "there"}, it's ${coach.name ?? "your coach"} about our ${s.title.toLowerCase().startsWith("private session") ? "session" : `“${s.title}” session`} on ${dayOf(s.startsAt, tz, longDay)} at ${formatTime(s.startsAt, tz)}, ${s.clubName}.`;
  const solo = going.length === 1 ? going[0]! : null;
  const emailAll = mailtoAll(
    going.map((a) => a.email),
    `${s.title} · ${dayOf(s.startsAt, tz, shortDay)} ${formatTime(s.startsAt, tz)}`,
  );
  const status = statusBadge[s.status];

  return (
    <div className="space-y-6">
      <Link href="/dashboard/coach" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Schedule
      </Link>

      {/* When and where */}
      <section aria-labelledby="session-title" className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="h-1.5" style={{ background: kindStyle[s.kind].color }} aria-hidden />
        <div className="space-y-4 p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">
              <span className="mr-1 inline-block size-2 rounded-sm" style={{ background: kindStyle[s.kind].color }} aria-hidden />
              {kindStyle[s.kind].label}
            </Badge>
            {status && <Badge variant={status.variant}>{status.label}</Badge>}
            {s.status !== "CANCELLED" && (
              <Badge variant={timing.phase === "live" ? "lime" : timing.phase === "soon" ? "warning" : "neutral"}>
                <Clock className="mr-1 size-3" aria-hidden />
                {timing.label}
              </Badge>
            )}
          </div>
          <div>
            <h1 id="session-title" className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {s.title}
            </h1>
            <p className="mt-1 text-base font-medium tabular-nums">
              {when} <span className="font-normal text-muted-foreground">({minutes} min)</span>
            </p>
            <p className="mt-2 flex items-start gap-1.5 text-sm text-muted-foreground">
              <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                <span className="font-medium text-foreground">
                  {s.clubName} · {s.facilityName}
                </span>
                {address && <span className="block">{address}</span>}
              </span>
            </p>
            {s.status === "CANCELLED" && s.cancellationReason && <p className="mt-3 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">Cancelled: {s.cancellationReason}</p>}
          </div>

          {/* Big, thumb-friendly actions */}
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <QuickAction href={directions} external icon={<Navigation className="size-4" aria-hidden />}>
              Directions
            </QuickAction>
            <QuickAction href={`/dashboard/coach/sessions/${s.id}/calendar`} icon={<CalendarPlus className="size-4" aria-hidden />}>
              <span className="sm:hidden">Calendar</span>
              <span className="hidden sm:inline">Add to calendar</span>
            </QuickAction>
            {solo?.phone && (
              <QuickAction href={`tel:${solo.phone}`} icon={<Phone className="size-4" aria-hidden />} primary>
                Call {(solo.name ?? "athlete").split(" ")[0]}
              </QuickAction>
            )}
            {solo?.phone && whatsappUrl(solo.phone, message(solo)) && (
              <QuickAction href={whatsappUrl(solo.phone, message(solo))!} external icon={<MessageCircle className="size-4" aria-hidden />}>
                WhatsApp
              </QuickAction>
            )}
            {emailAll && (
              <QuickAction href={emailAll} icon={<Mail className="size-4" aria-hidden />}>
                {going.length > 1 ? `Email all ${going.length}` : "Email"}
              </QuickAction>
            )}
            {s.clubPhone && (
              <QuickAction href={`tel:${s.clubPhone}`} icon={<Phone className="size-4" aria-hidden />}>
                Call the club
              </QuickAction>
            )}
          </div>
        </div>
      </section>

      {/* Who's coming */}
      <Panel
        title={`Athletes · ${going.length}${s.maxParticipants !== null ? `/${s.maxParticipants}` : ""}`}
        action={
          s.priceAmount > 0 ? (
            <span className="text-xs text-muted-foreground tabular-nums">
              {money(expected)} expected · {money(paidOnline)} paid online
            </span>
          ) : undefined
        }
      >
        {going.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">No athletes yet.{upcoming && !full && " Add one below."}</p>
        ) : (
          <ul className="divide-y divide-border">
            {going.map((a) => (
              <AthleteRow key={a.participantId} a={a} s={s} tz={tz} checkIn={s.status !== "CANCELLED" && checkInOpen(s.startsAt, now)} message={message(a)} />
            ))}
          </ul>
        )}
        {waiting.length > 0 && (
          <div className="border-t border-border px-5 py-3 text-sm">
            <p className="font-medium">Not confirmed yet</p>
            <ul className="mt-1 space-y-1 text-muted-foreground">
              {waiting.map((a) => (
                <li key={a.participantId}>
                  {a.name ?? a.email} · {a.status === "WAITLISTED" ? "on the waitlist" : "invited"}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title="Details">
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 px-5 py-4 text-sm">
            <dt className="text-muted-foreground">Sport</dt>
            <dd>{s.sportName}</dd>
            {(s.minLevel !== null || s.maxLevel !== null) && (
              <>
                <dt className="text-muted-foreground">Level</dt>
                <dd className="tabular-nums">{s.minLevel !== null && s.maxLevel !== null ? `${s.minLevel.toFixed(1)}–${s.maxLevel.toFixed(1)}` : `${(s.minLevel ?? s.maxLevel)!.toFixed(1)}`}</dd>
              </>
            )}
            <dt className="text-muted-foreground">Price</dt>
            <dd>{s.priceAmount > 0 ? `${money(s.priceAmount)} per athlete` : "Free"}</dd>
            <dt className="text-muted-foreground">Places</dt>
            <dd className="flex items-center gap-1.5">
              <Users className="size-3.5 text-muted-foreground" aria-hidden />
              {going.length} of {s.maxParticipants ?? "unlimited"}
              {full && <Badge variant="neutral">Full</Badge>}
            </dd>
            <dt className="text-muted-foreground">Equipment</dt>
            <dd>{s.equipment.length ? s.equipment.map((e) => `${e.name} × ${e.quantity}`).join(", ") : "None reserved"}</dd>
            {s.description && (
              <>
                <dt className="text-muted-foreground">Plan</dt>
                <dd className="whitespace-pre-line">{s.description}</dd>
              </>
            )}
          </dl>
        </Panel>

        <Panel title="Manage">
          <div className="space-y-4 px-5 py-4">
            {upcoming && !full && (
              <ActionForm action={addParticipant} hidden={{ sessionId: s.id }} label={`Add a student to ${s.title}`} className="space-y-2">
                <Field name="email" label="Add a student by email" type="email" autoComplete="off" />
                <FormFooter submit="Add student" pendingLabel="Adding…" variant="outline" />
              </ActionForm>
            )}
            {started && s.status !== "COMPLETED" && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">Done? Completing it counts it towards your hours.</p>
                <ActionButton action={completeSession} hidden={{ sessionId: s.id }} variant="primary">
                  Mark completed
                </ActionButton>
              </div>
            )}
            {upcoming && (
              <details className="rounded-xl border border-border px-3 py-2">
                <summary className="cursor-pointer text-sm font-semibold text-danger">Cancel this session</summary>
                <ActionForm action={cancelSession} hidden={{ sessionId: s.id }} label={`Cancel ${s.title}`} className="mt-2 space-y-2">
                  <Field name="reason" label="Reason (shown to the athletes)" maxLength={200} placeholder="Coach unwell" />
                  <FormFooter submit="Cancel session" pendingLabel="Cancelling…" />
                </ActionForm>
              </details>
            )}
            {!upcoming && !started && <p className="text-sm text-muted-foreground">Nothing left to manage on this session.</p>}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function QuickAction({ href, icon, children, external = false, primary = false }: { href: string; icon: ReactNode; children: ReactNode; external?: boolean; primary?: boolean }) {
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className={cn(
        "inline-flex h-11 items-center justify-center gap-2 rounded-full border px-4 text-sm font-semibold transition",
        primary ? "border-ink bg-ink text-ink-foreground hover:opacity-90" : "border-border bg-background hover:bg-muted",
      )}
    >
      {icon}
      <span className="truncate">{children}</span>
    </a>
  );
}

function AthleteRow({ a, s, tz, checkIn, message }: { a: SessionAthlete; s: CoachSessionDetail; tz: string; checkIn: boolean; message: string }) {
  const name = a.name ?? a.email;
  const phone = a.phone ? formatPhone(a.phone) : null;
  const wa = a.phone ? whatsappUrl(a.phone, message) : null;
  const level = a.levelRating !== null ? `Level ${a.levelRating.toFixed(1)}` : a.level;
  const payment =
    s.priceAmount === 0
      ? null
      : a.paymentStatus === "SUCCEEDED"
        ? { text: `Paid online · ${formatMoney(a.paymentAmount ?? s.priceAmount, s.currency)}`, tone: "text-success" }
        : a.paymentStatus && ["REQUIRES_PAYMENT_METHOD", "REQUIRES_CONFIRMATION", "REQUIRES_ACTION", "PROCESSING"].includes(a.paymentStatus)
          ? { text: "Payment pending", tone: "text-warning" }
          : { text: `To collect at the club · ${formatMoney(s.priceAmount, s.currency)}`, tone: "text-muted-foreground" };
  const contact = "inline-flex h-10 items-center gap-1.5 rounded-full border border-border px-3 text-sm font-medium hover:bg-muted";

  return (
    <li className="space-y-3 px-5 py-4" data-participant-id={a.participantId}>
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold" aria-hidden>
          {initials(name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            {name}
            {a.handle && <span className="ml-1.5 text-sm font-normal text-muted-foreground">@{a.handle}</span>}
          </p>
          <p className="text-xs text-muted-foreground">
            {level && <>{level} · </>}
            {historyLabel(a.previous, a.lastAt ? dayOf(a.lastAt, tz, shortDay) : null)}
          </p>
          {payment && <p className={cn("text-xs font-medium", payment.tone)}>{payment.text}</p>}
        </div>
      </div>

      <div className="flex flex-wrap gap-2" aria-label={`Contact ${name}`}>
        {a.phone && phone && (
          <a href={`tel:${a.phone}`} className={contact} aria-label={`Call ${name}, ${phone}`}>
            <Phone className="size-4" aria-hidden /> <span className="tabular-nums">{phone}</span>
          </a>
        )}
        {wa && (
          <a href={wa} target="_blank" rel="noopener noreferrer" className={contact} aria-label={`WhatsApp ${name}`}>
            <MessageCircle className="size-4" aria-hidden /> WhatsApp
          </a>
        )}
        <a href={`mailto:${encodeURIComponent(a.email)}`} className={contact} aria-label={`Email ${name}`}>
          <Mail className="size-4" aria-hidden /> Email
        </a>
        {!a.phone && <span className="self-center text-xs text-muted-foreground">No phone number on their profile</span>}
      </div>

      <div className="flex flex-wrap items-center gap-2" aria-label={`Attendance for ${name}`}>
        {checkIn ? (
          attendanceButtons.map((b) => (
            <ActionButton key={b.status} action={markAttendance} hidden={{ participantId: a.participantId, status: b.status }} variant={a.attendance === b.status ? "primary" : "outline"}>
              {b.label}
            </ActionButton>
          ))
        ) : (
          <p className="text-xs text-muted-foreground">Check-in opens {CHECK_IN_MINUTES} minutes before the start.</p>
        )}
      </div>

      {a.attendance && (
        <details className="rounded-xl border border-border px-3 py-2" open={!!a.feedback}>
          <summary className="cursor-pointer text-sm font-medium">
            Private note{a.rating ? ` · ${"★".repeat(a.rating)}${"☆".repeat(5 - a.rating)}` : ""}
          </summary>
          <ActionForm action={saveFeedback} hidden={{ participantId: a.participantId }} label={`Note on ${name}`} className="mt-2 grid gap-2 sm:grid-cols-[1fr_9rem_auto] sm:items-end">
            <Field name="feedback" label="What to work on next" defaultValue={a.feedback ?? ""} maxLength={500} placeholder="Bandeja contact point; footwork to the net" />
            <SelectField
              name="rating"
              label="Session"
              defaultValue={a.rating ? String(a.rating) : ""}
              options={[{ value: "", label: "No rating" }, ...[5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: `${"★".repeat(n)} ${n}/5` }))]}
            />
            <FormFooter submit="Save note" pendingLabel="Saving…" variant="outline" />
          </ActionForm>
          <p className="mt-1 text-xs text-muted-foreground">Only you see this. It stays with {name.split(" ")[0]}&apos;s check-in.</p>
        </details>
      )}
    </li>
  );
}
