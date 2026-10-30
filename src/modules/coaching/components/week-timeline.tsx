import type { Route } from "next";
import Link from "next/link";

import { cn } from "@/lib/utils";

import type { CoachSession } from "../queries/schedule";

// The coach's week as a timeline (large screens) or an agenda (phones).
// Kinds use --chart-1..3 (validated together); text stays in text colours,
// the colour only marks the block's edge and tint, and the kind is also
// written out, so it's never colour alone.

export const kindStyle = {
  GROUP: { label: "Group", color: "var(--chart-1)" },
  PRIVATE: { label: "Private", color: "var(--chart-2)" },
  OPEN_MATCH: { label: "Open match", color: "var(--chart-3)" },
} as const;

export type DayColumn = { dateKey: string; label: string; sessions: (CoachSession & { startMinute: number; endMinute: number })[] };

const hh = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export function WeekTimeline({ days, fromHour, toHour, todayKey }: { days: DayColumn[]; fromHour: number; toHour: number; todayKey: string }) {
  const span = (toHour - fromHour) * 60;
  const pct = (minute: number) => `${((Math.min(Math.max(minute, fromHour * 60), toHour * 60) - fromHour * 60) / span) * 100}%`;
  const hours = Array.from({ length: toHour - fromHour + 1 }, (_, i) => fromHour + i);
  const total = days.reduce((n, d) => n + d.sessions.length, 0);

  return (
    <div className="space-y-3 p-5">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
        {Object.values(kindStyle).map((k) => (
          <li key={k.label} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: k.color }} aria-hidden />
            {k.label}
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm border border-dashed border-muted-foreground" aria-hidden />
          Cancelled
        </li>
      </ul>

      {/* Timeline: large screens */}
      <div className="hidden lg:block">
        <div className="grid grid-cols-[3rem_repeat(7,minmax(0,1fr))] gap-1">
          <span />
          {days.map((d) => (
            <span key={d.dateKey} className={cn("rounded-md px-1 py-1 text-center text-xs font-medium", d.dateKey === todayKey && "bg-ink text-ink-foreground")}>
              {d.label}
            </span>
          ))}
          <div className="relative h-[560px]">
            {hours.map((h) => (
              <span key={h} className="absolute right-1 -translate-y-1/2 text-[10px] text-muted-foreground" style={{ top: pct(h * 60) }}>
                {hh(h * 60)}
              </span>
            ))}
          </div>
          {days.map((d) => (
            <div key={d.dateKey} className="relative h-[560px] rounded-md bg-muted/50">
              {hours.map((h) => (
                <span key={h} className="absolute inset-x-0 border-t border-border/60" style={{ top: pct(h * 60) }} aria-hidden />
              ))}
              {d.sessions.map((s) => {
                const k = kindStyle[s.kind];
                const cancelled = s.status === "CANCELLED";
                return (
                  <Link
                    key={s.id}
                    href={`#session-${s.id}` as Route}
                    title={`${k.label}: ${s.title}, ${hh(s.startMinute)}–${hh(s.endMinute)}, ${s.clubName} · ${s.facilityName}`}
                    className={cn("absolute inset-x-0.5 overflow-hidden rounded-md border-l-[3px] px-1.5 py-1 text-[11px] leading-tight", cancelled && "border-dashed opacity-50")}
                    style={{
                      top: pct(s.startMinute),
                      height: `calc(${pct(s.endMinute)} - ${pct(s.startMinute)})`,
                      borderLeftColor: k.color,
                      background: `color-mix(in oklab, ${k.color} 16%, var(--card))`,
                    }}
                  >
                    <span className="block font-medium">{hh(s.startMinute)}</span>
                    <span className="block truncate">{s.title}</span>
                    <span className="block truncate text-muted-foreground">
                      {s.participants}/{s.maxParticipants ?? "∞"}
                    </span>
                  </Link>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Agenda: phones and tablets */}
      <ol className="space-y-4 lg:hidden">
        {days
          .filter((d) => d.sessions.length > 0)
          .map((d) => (
            <li key={d.dateKey}>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{d.label}</p>
              <ul className="mt-2 space-y-2">
                {d.sessions.map((s) => (
                  <li
                    key={s.id}
                    className={cn("rounded-lg border-l-[3px] px-3 py-2 text-sm", s.status === "CANCELLED" && "opacity-50")}
                    style={{ borderLeftColor: kindStyle[s.kind].color, background: `color-mix(in oklab, ${kindStyle[s.kind].color} 12%, var(--card))` }}
                  >
                    <span className="font-medium tabular-nums">
                      {hh(s.startMinute)}–{hh(s.endMinute)}
                    </span>{" "}
                    {s.title} <span className="text-muted-foreground">· {kindStyle[s.kind].label} · {s.clubName}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        {total === 0 && <li className="text-sm text-muted-foreground">Nothing scheduled this week.</li>}
      </ol>
    </div>
  );
}
