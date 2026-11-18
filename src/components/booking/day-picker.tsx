import type { Route } from "next";
import Link from "next/link";

import { cn } from "@/lib/utils";

// The row of day buttons above a booking grid ("Tue" / "18 Nov"). Plain
// links: the day lives in the URL, so it survives a reload and works
// before JavaScript has loaded.

const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" });
const dayMonth = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** "Tue" and "18 Nov" for a local date key (read at noon UTC, so no zone can shift the day). */
export const dayName = (key: string) => weekday.format(new Date(`${key}T12:00:00Z`));
export const dayNumber = (key: string) => dayMonth.format(new Date(`${key}T12:00:00Z`));
export const dayLabel = (key: string) => `${dayName(key)} ${dayNumber(key)}`;

export function DayPicker({ days, current, href }: { days: string[]; current: string; href: (day: string) => Route }) {
  return (
    <nav aria-label="Day" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
      {days.map((d) => (
        <Link
          key={d}
          href={href(d)}
          aria-current={d === current ? "date" : undefined}
          className={cn(
            "flex min-w-14 shrink-0 flex-col items-center whitespace-nowrap rounded-xl border px-2 py-1.5 text-xs transition",
            d === current ? "border-ink bg-ink text-ink-foreground" : "border-border bg-background hover:border-foreground/40",
          )}
        >
          <span className="font-medium">{dayName(d)}</span>
          <span className="tabular-nums">{dayNumber(d)}</span>
        </Link>
      ))}
    </nav>
  );
}
