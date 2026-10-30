import { Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState, formatTime, PageHeader } from "@/components/dashboard/ui";
import { ActionButton } from "@/components/forms/action-form";
import { Badge } from "@/components/ui/badge";
import { pickParam } from "@/lib/list-params";
import { cn, formatMoney } from "@/lib/utils";
import { zonedParts } from "@/modules/clubs/lib/zoned-time";
import { releaseExpiredHolds } from "@/modules/payments/settle";
import { stripeConfigured } from "@/modules/payments/stripe";
import { joinOpenMatch } from "@/modules/student/actions/matches";
import { levelFits } from "@/modules/student/lib/cancellation";
import { requireStudent } from "@/modules/student/dal";
import { getMyLevels, listMatchClubs, listOpenMatches, listSports, type OpenMatch } from "@/modules/student/queries/matches";

export const metadata: Metadata = { title: "Open Match Finder" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const dayFormat = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const day = (m: OpenMatch) => dayFormat.format(new Date(`${zonedParts(m.startsAt, m.timezone).dateKey}T12:00:00Z`));
const levelText = (m: OpenMatch) =>
  m.minLevel === null && m.maxLevel === null ? "All levels" : `Level ${m.minLevel?.toFixed(1) ?? "0.0"}–${m.maxLevel?.toFixed(1) ?? "10.0"}`;
const id = (v: unknown) => (typeof v === "string" && /^[a-z0-9]{1,64}$/.test(v) ? v : null);

export default async function OpenMatchesPage({ searchParams }: { searchParams: SearchParams }) {
  const student = await requireStudent();
  const sp = await searchParams;
  await releaseExpiredHolds();
  const [sports, clubs, levels] = await Promise.all([listSports(), listMatchClubs(student.id), getMyLevels(student.id)]);
  const sportId = id(sp.sport) && sports.some((s) => s.id === sp.sport) ? (sp.sport as string) : null;
  const clubId = id(sp.club) && clubs.some((c) => c.id === sp.club) ? (sp.club as string) : null;
  const fit = pickParam(sp.fit, ["all", "mine"] as const, "mine");
  const matches = (await listOpenMatches(student.id, { sportId, clubId, days: 21 })).filter(
    (m) => fit === "all" || m.joined || levelFits(levels.get(m.sportId) ?? null, m.minLevel, m.maxLevel),
  );
  const online = stripeConfigured();
  const select = "h-10 w-full rounded-full border border-border bg-card px-4 text-sm";

  return (
    <div className="space-y-6">
      <PageHeader title="Open match finder" description="Games looking for players at your level. Join, and pay just your share of the court." />

      <form className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]" aria-label="Match filters">
        <label>
          <span className="sr-only">Sport</span>
          <select name="sport" defaultValue={sportId ?? ""} className={select}>
            <option value="">All sports</option>
            {sports.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {levels.get(s.id) != null ? ` (you: ${levels.get(s.id)!.toFixed(1)})` : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Club</span>
          <select name="club" defaultValue={clubId ?? ""} className={select}>
            <option value="">All clubs</option>
            {clubs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.preferred ? " ★" : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Level</span>
          <select name="fit" defaultValue={fit} className={select}>
            <option value="mine">Matches at my level</option>
            <option value="all">All levels</option>
          </select>
        </label>
        <button type="submit" className="h-10 rounded-full bg-ink px-5 text-sm font-semibold text-ink-foreground">
          Show
        </button>
      </form>

      {levels.size === 0 && (
        <p className="rounded-2xl border border-border bg-card px-4 py-3 text-sm">
          Set your level in <Link href="/dashboard/student/settings" className="font-medium text-accent-text hover:underline">Account settings</Link> to see level-matched games.
        </p>
      )}

      {matches.length === 0 ? (
        <EmptyState>No open matches {fit === "mine" ? "at your level " : ""}in the next 3 weeks. Try all levels or another club.</EmptyState>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {matches.map((m) => {
            const seats = m.maxParticipants ?? 4;
            const full = m.players >= seats;
            const mine = levelFits(levels.get(m.sportId) ?? null, m.minLevel, m.maxLevel);
            return (
              <li key={m.id} aria-label={`${levelText(m)} ${m.sportName}, ${day(m)}`} className="flex flex-col rounded-2xl border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold">
                    {levelText(m)} {m.sportName}
                  </p>
                  {m.joined ? <Badge variant="success">You're in</Badge> : full ? <Badge variant="outline">Full</Badge> : !mine ? <Badge variant="warning">Not your level</Badge> : null}
                </div>
                <p className="mt-1 text-sm tabular-nums">
                  {day(m)} · {formatTime(m.startsAt, m.timezone)}–{formatTime(m.endsAt, m.timezone)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {m.clubName}
                  {m.city && `, ${m.city}`} · {m.facilityName} · hosted by {m.coachName}
                </p>
                <div className="mt-3 flex items-center gap-2 text-sm" aria-label={`${m.players} of ${seats} players`}>
                  <Users className="size-4 text-muted-foreground" aria-hidden />
                  <span className="flex gap-1" aria-hidden>
                    {Array.from({ length: seats }, (_, i) => (
                      <span key={i} className={cn("size-3 rounded-full border", i < m.players ? "border-chart-1 bg-chart-1" : "border-border bg-muted")} />
                    ))}
                  </span>
                  <span className="tabular-nums">
                    {m.players}/{seats} slots filled
                  </span>
                </div>
                <div className="mt-auto flex flex-wrap items-end justify-between gap-2 pt-4">
                  <p className="text-sm">
                    <span className="font-semibold">{m.priceAmount > 0 ? formatMoney(m.priceAmount, m.currency) : "Free"}</span>
                    {m.priceAmount > 0 && <span className="block text-xs text-muted-foreground">your share, per player</span>}
                  </p>
                  {!m.joined && !full && mine && (
                    <ActionButton action={joinOpenMatch} hidden={{ sessionId: m.id }} variant="primary" pendingLabel={online && m.priceAmount > 0 ? "Opening checkout…" : "Joining…"}>
                      {m.priceAmount > 0 ? (online ? `Join & pay ${formatMoney(m.priceAmount, m.currency)}` : "Join (pay at club)") : "Join"}
                    </ActionButton>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
