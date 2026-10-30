import { ExternalLink } from "lucide-react";
import type { Metadata, Route } from "next";
import Link from "next/link";

import { EmptyState, PageHeader, Panel } from "@/components/dashboard/ui";
import { ActionButton, ActionForm, CheckboxField, CheckboxGroup, Field, FormFooter, SelectField } from "@/components/forms/action-form";
import { Badge } from "@/components/ui/badge";
import { centsToInput } from "@/lib/money-input";
import { formatMoney } from "@/lib/utils";
import { dayLabels, formatDays } from "@/modules/clubs/lib/labels";
import { minuteToTime } from "@/modules/clubs/lib/zoned-time";
import { addWindow, deleteWindows, saveProfile } from "@/modules/coaching/actions/availability";
import { getCoachClubs, getCoachProfile, requireCoach } from "@/modules/coaching/dal";
import { getOpenSlots, listWindows } from "@/modules/coaching/queries/booking";
import { getSessionFormOptions } from "@/modules/coaching/queries/schedule";

export const metadata: Metadata = { title: "Booking Link & Rates" };

const timeZoneOptions = Intl.supportedValuesOf("timeZone").map((tz) => ({ value: tz, label: tz.replaceAll("_", " ") }));
const dayOptions = dayLabels.map((label, i) => ({ value: String(i + 1), label }));
const lengthOptions = ["30", "45", "60", "75", "90", "120"].map((m) => ({ value: m, label: `${m} minutes` }));

export default async function AvailabilityPage() {
  const coach = await requireCoach();
  const [profile, clubs, windows] = await Promise.all([getCoachProfile(coach), getCoachClubs(coach.id), listWindows(coach.id)]);
  const options = await getSessionFormOptions(clubs.map((c) => c.clubId));
  const slots = profile.bookingEnabled ? await getOpenSlots({ userId: coach.id, sessionMinutes: profile.sessionMinutes, minNoticeHours: profile.minNoticeHours, maxAdvanceDays: profile.maxAdvanceDays }) : [];
  const money = (n: number) => formatMoney(n, profile.currency);

  // One row per window shown once for all its weekdays.
  const groups = new Map<string, { ids: string[]; days: number[]; w: (typeof windows)[number] }>();
  for (const w of windows) {
    const key = `${w.clubId}-${w.facilityName}-${w.startMinute}-${w.endMinute}`;
    const g = groups.get(key) ?? { ids: [], days: [], w };
    g.ids.push(w.id);
    g.days.push(w.dayOfWeek);
    groups.set(key, g);
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Booking link & rates" description="Your public page where students book private sessions, your weekly hours, and your prices." />

      <Panel
        title="Public booking link"
        action={
          profile.bookingEnabled ? (
            <Link href={`/coach/${profile.slug}` as Route} className="inline-flex items-center gap-1.5 text-sm font-medium text-accent-text hover:underline">
              <ExternalLink className="size-4" aria-hidden /> Open page
            </Link>
          ) : (
            <Badge variant="outline">Off</Badge>
          )
        }
      >
        <ActionForm action={saveProfile} label="Booking page settings" className="space-y-4 p-5">
          <Field name="slug" label="Your link" defaultValue={profile.slug} maxLength={48} spellCheck={false} autoComplete="off" hint={`nexport.com/coach/${profile.slug}`} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field name="headline" label="Headline" defaultValue={profile.headline ?? ""} maxLength={80} placeholder="Padel coach · ex-WPT" />
            <SelectField name="sportId" label="Sport you're booked for" options={[{ value: "", label: "Choose…" }, ...options.sports.map((s) => ({ value: s.id, label: s.label }))]} defaultValue={profile.sportId ?? ""} />
            <Field name="privateRate" label={`Private rate per hour (${profile.currency.toUpperCase()})`} defaultValue={profile.privateRateAmount === null ? "" : centsToInput(profile.privateRateAmount)} inputMode="decimal" />
            <Field name="groupRate" label={`Group rate per person per hour (${profile.currency.toUpperCase()})`} defaultValue={profile.groupRateAmount === null ? "" : centsToInput(profile.groupRateAmount)} inputMode="decimal" hint="Shown on your page" />
            <SelectField name="sessionMinutes" label="Session length" options={lengthOptions} defaultValue={String(profile.sessionMinutes)} />
            <SelectField name="timezone" label="Your time zone" options={timeZoneOptions} defaultValue={profile.timezone} />
            <Field name="minNoticeHours" label="Minimum notice (hours)" defaultValue={String(profile.minNoticeHours)} inputMode="numeric" />
            <Field name="maxAdvanceDays" label="Book up to (days ahead)" defaultValue={String(profile.maxAdvanceDays)} inputMode="numeric" />
          </div>
          <Field name="bio" label="About you" defaultValue={profile.bio ?? ""} maxLength={600} />
          <CheckboxField name="bookingEnabled" label="Students can book me online" hint="Needs a private rate, a sport and at least one availability window" defaultChecked={profile.bookingEnabled} />
          <FormFooter submit="Save" />
        </ActionForm>
        {profile.bookingEnabled && (
          <p className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
            {slots.length} open {slots.length === 1 ? "slot" : "slots"} in the next {profile.maxAdvanceDays} days
            {profile.privateRateAmount !== null && <> · {money(Math.round((profile.privateRateAmount * profile.sessionMinutes) / 60))} per {profile.sessionMinutes}-minute session</>}
          </p>
        )}
      </Panel>

      <Panel title="Weekly availability">
        {groups.size === 0 ? (
          <EmptyState>No working hours yet. Add when and where you take private sessions.</EmptyState>
        ) : (
          <ul className="divide-y divide-border" aria-label="Availability windows">
            {[...groups.values()].map(({ ids, days, w }) => (
              <li key={ids.join(",")} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                <span className="min-w-0">
                  <span className="font-medium tabular-nums">
                    {formatDays(days)} · {minuteToTime(w.startMinute)}–{minuteToTime(w.endMinute)}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {w.clubName}
                    {w.facilityName ? ` · prefers ${w.facilityName}` : " · any free court"} · {w.timezone}
                  </span>
                </span>
                <ActionButton action={deleteWindows} hidden={{ windowIds: ids.join(",") }} variant="ghost">
                  Remove
                </ActionButton>
              </li>
            ))}
          </ul>
        )}
        {clubs.length > 0 ? (
          <details className="border-t border-border px-5 py-3">
            <summary className="cursor-pointer text-sm font-medium text-accent-text">Add working hours</summary>
            <ActionForm action={addWindow} label="Add working hours" className="mt-3 space-y-3">
              <CheckboxGroup name="days" legend="Days" options={dayOptions} />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field name="startTime" label="From" type="time" step={900} defaultValue="17:00" hint="Club's local time" />
                <Field name="endTime" label="Until" type="time" step={900} defaultValue="20:00" />
                <SelectField name="clubId" label="Club" options={clubs.map((c) => ({ value: c.clubId, label: c.name }))} />
                <SelectField name="facilityId" label="Preferred court" options={[{ value: "", label: "Any free court" }, ...options.facilities.map((f) => ({ value: f.id, label: f.label }))]} />
              </div>
              <FormFooter submit="Add hours" />
            </ActionForm>
          </details>
        ) : (
          <p className="border-t border-border px-5 py-3 text-sm text-muted-foreground">Join a club roster to add working hours.</p>
        )}
      </Panel>
    </div>
  );
}
