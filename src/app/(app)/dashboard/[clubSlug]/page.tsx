import { Gauge, IdCard, Users, Wallet } from "lucide-react";
import type { Metadata, Route } from "next";
import Link from "next/link";

import { KpiCard, PageHeader, Panel } from "@/components/dashboard/ui";
import { formatMoney } from "@/lib/utils";
import { OccupancyHeatmap } from "@/modules/clubs/components/occupancy-heatmap";
import { RevenueChart } from "@/modules/clubs/components/revenue-chart";
import { can, requireClubAccess } from "@/modules/clubs/dal";
import { canOpenSection, clubSections } from "@/modules/clubs/lib/permissions";
import { getMemberStats, getOccupancyHeatmap, getRevenueByMonth, getUtilisation } from "@/modules/clubs/queries/overview";

export const metadata: Metadata = { title: "Club overview" };

const percent = (value: number | null) => (value === null ? "—" : `${(value * 100).toFixed(1)}%`);
const hours = (value: number) => `${Math.round(value).toLocaleString("en")} h`;

export default async function ClubOverviewPage({ params }: { params: Promise<{ clubSlug: string }> }) {
  const { clubSlug } = await params;
  const access = await requireClubAccess(clubSlug);
  const { club } = access;

  if (!can(access, "VIEW_ANALYTICS")) {
    const sections = clubSections.filter((s) => s.key !== "overview" && canOpenSection(access, s.key));
    return (
      <div className="space-y-6">
        <PageHeader title={`Welcome to ${club.name}`} description="Your role doesn't include analytics. These are the sections you can work in:" />
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {sections.map((s) => (
            <li key={s.key}>
              <Link href={`/dashboard/${club.slug}${s.path}` as Route} className="block rounded-2xl border border-border bg-card p-5 font-medium hover:bg-muted/60">
                {s.label}
              </Link>
            </li>
          ))}
          {sections.length === 0 && <li className="text-sm text-muted-foreground">No sections yet. Ask the club owner to grant you permissions.</li>}
        </ul>
      </div>
    );
  }

  const [utilisation, revenue, members, heatmap] = await Promise.all([
    getUtilisation(club),
    getRevenueByMonth(club),
    getMemberStats(club),
    getOccupancyHeatmap(club),
  ]);
  const money = (n: number) => formatMoney(n, club.currency);
  const sum = (p: (typeof revenue)[number] | undefined) => (p ? p.rentals + p.coaching + p.memberships : 0);
  const thisMonth = revenue.at(-1);
  const lastMonth = revenue.at(-2);
  const change = lastMonth && sum(lastMonth) > 0 ? (sum(thisMonth) - sum(lastMonth)) / sum(lastMonth) : null;
  const facilities = utilisation.facilities;

  return (
    <div className="space-y-6">
      <PageHeader title="Overview" description={`Bookings, revenue and members for ${club.name}. Times in ${club.timezone}.`} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Court utilisation, last 30 days"
          icon={<Gauge className="size-4" aria-hidden />}
          value={percent(utilisation.rate)}
          hint={utilisation.availableHours > 0 ? `${hours(utilisation.bookedHours)} booked of ${hours(utilisation.availableHours)} open` : "Add a facility to start tracking"}
        />
        <KpiCard
          label="Revenue this month"
          icon={<Wallet className="size-4" aria-hidden />}
          value={money(sum(thisMonth))}
          hint={change === null ? "No revenue last month to compare" : `${change >= 0 ? "+" : ""}${(change * 100).toFixed(0)}% vs last month`}
        />
        <KpiCard
          label="Active members"
          icon={<Users className="size-4" aria-hidden />}
          value={members.members.toLocaleString("en")}
          hint={`${members.newMembers} joined in the last 30 days`}
        />
        <KpiCard
          label="Pass holders"
          icon={<IdCard className="size-4" aria-hidden />}
          value={members.passHolders.toLocaleString("en")}
          hint={`${members.unlimited} unlimited · ${members.credit} session passes · ${members.expiringSoon} expire this week`}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel title="Monthly revenue breakdown">
          <RevenueChart data={revenue} currency={club.currency} />
        </Panel>
        <Panel title="Peak hours, last 4 weeks">
          <OccupancyHeatmap cells={heatmap.cells} facilities={heatmap.facilities} fromHour={heatmap.fromHour} toHour={heatmap.toHour} />
        </Panel>
      </div>

      <Panel title="Utilisation by facility, last 30 days">
        {facilities.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">No active facilities yet.</p>
        ) : (
          <ul className="space-y-3 p-5">
            {facilities.map((f) => {
              const rate = f.availableHours > 0 ? Math.min(1, f.bookedHours / f.availableHours) : 0;
              return (
                <li key={f.id} className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)_4rem] items-center gap-3 text-sm">
                  <span className="truncate">{f.name}</span>
                  <span className="h-2 rounded-full bg-muted" aria-hidden>
                    <span className="block h-full rounded-full bg-chart-1" style={{ width: `${rate * 100}%` }} />
                  </span>
                  <span className="text-right tabular-nums">{percent(rate)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
