import { ExternalLink } from "lucide-react";
import type { Metadata, Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { SectionNav, type NavItem } from "@/components/dashboard/section-nav";
import { Badge } from "@/components/ui/badge";
import { getCoachClubs, getCoachProfile, requireCoach } from "@/modules/coaching/dal";

export const metadata: Metadata = { title: { default: "Coach dashboard", template: "%s · Coach · nexport" } };

const items: NavItem[] = [
  { path: "", label: "Schedule & Sessions", icon: "sessions" },
  { path: "/students", label: "Students & Credits", icon: "students" },
  { path: "/availability", label: "Booking Link & Rates", icon: "availability" },
  { path: "/earnings", label: "Earnings & Stripe", icon: "earnings" },
];

// Coach-only shell. The proxy has already sent signed-out visitors to /login;
// the role is checked here (and again in every page and action) because
// sessions live in the database, which the proxy doesn't query.
export default async function CoachLayout({ children }: { children: ReactNode }) {
  const coach = await requireCoach();
  const [clubs, profile] = await Promise.all([getCoachClubs(coach.id), getCoachProfile(coach)]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Coach dashboard</p>
          <p className="truncate text-lg font-semibold">{coach.name ?? coach.email}</p>
          <p className="text-xs text-muted-foreground">{clubs.length ? `Coaching at ${clubs.map((c) => c.name).join(", ")}` : "Not on a club roster yet"}</p>
        </div>
        {profile.bookingEnabled ? (
          <Link href={`/coach/${profile.slug}` as Route} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-medium hover:bg-muted">
            <ExternalLink className="size-3.5" aria-hidden /> /coach/{profile.slug}
          </Link>
        ) : (
          <Badge variant="outline">Booking page off</Badge>
        )}
      </div>
      {clubs.length === 0 && (
        <div className="rounded-2xl border border-border bg-card px-4 py-3 text-sm">
          <span className="font-semibold">You can schedule once a club adds you.</span> Ask the club to add <span className="font-mono">{coach.email}</span> as a coach
          on its Staff &amp; Payroll page.
        </div>
      )}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-10">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <SectionNav label="Coach" base="/dashboard/coach" items={items} />
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
