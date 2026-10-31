import { BadgeCheck, CalendarCheck, Ticket } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState, formatDate, KpiCard, PageHeader } from "@/components/dashboard/ui";
import { Badge } from "@/components/ui/badge";
import { BookingCard, bookingDay } from "@/modules/student/components/booking-card";
import { requireStudent } from "@/modules/student/dal";
import { getMyFeed, isPassValid, listMyClubs, listMyPasses } from "@/modules/student/queries/bookings";
import { loadPolicies } from "@/modules/student/queries/policy";

export const metadata: Metadata = { title: "Overview & Upcoming" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function StudentOverviewPage({ searchParams }: { searchParams: SearchParams }) {
  const student = await requireStudent();
  const checkout = (await searchParams).checkout;
  const [feed, passes, clubs] = await Promise.all([getMyFeed(student.id), listMyPasses(student.id), listMyClubs(student.id)]);
  const policyFor = await loadPolicies(feed.map((b) => ({ clubId: b.clubId, policyId: b.policyId })));

  const now = Date.now();
  const valid = passes.filter((p) => isPassValid(p, now));
  const creditPasses = valid.filter((p) => p.creditsTotal !== null).sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
  const unlimited = valid.filter((p) => p.creditsTotal === null);
  const main = creditPasses[0];
  const confirmed = feed.filter((b) => b.status === "CONFIRMED");
  const sessions = confirmed.filter((b) => b.kind === "session").length;
  const rentals = confirmed.filter((b) => b.kind === "rental").length;
  const next = feed.find((b) => b.status !== "CANCELLED");

  return (
    <div className="space-y-6">
      <PageHeader title={`Hi ${student.name?.split(" ")[0] ?? "there"}`} description="What's coming up, your passes and your clubs." />

      {checkout === "cancelled" && (
        <p role="status" className="rounded-2xl border border-border bg-card px-4 py-3 text-sm">
          Payment not completed. Your spot stays held for a little while: use <span className="font-medium">Pay now</span> below, or release it.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard
          label="Session passes"
          icon={<Ticket className="size-4" aria-hidden />}
          value={main ? `${main.creditsTotal! - main.creditsUsed}/${main.creditsTotal} sessions left` : unlimited.length ? "Unlimited" : "No pass"}
          hint={
            main
              ? `${main.planName} · ${main.clubName} · until ${formatDate(main.expiresAt)}${creditPasses.length > 1 ? ` · +${creditPasses.length - 1} more` : ""}`
              : unlimited[0]
                ? `${unlimited[0].planName} until ${formatDate(unlimited[0].expiresAt)}`
                : "Buy a pass at your club's front desk"
          }
        />
        <KpiCard
          label="Upcoming"
          icon={<CalendarCheck className="size-4" aria-hidden />}
          value={`${sessions} ${sessions === 1 ? "session" : "sessions"} · ${rentals} ${rentals === 1 ? "court" : "courts"}`}
          hint={next ? `Next: ${bookingDay(next)} · ${next.kind === "rental" ? "court rental" : next.title}` : "Nothing booked in the next 30 days"}
        />
        <KpiCard
          label="Memberships"
          icon={<BadgeCheck className="size-4" aria-hidden />}
          value={
            clubs.length || unlimited.length ? (
              <span className="flex flex-wrap gap-1.5">
                {clubs.map((c) => (
                  <Badge key={c.id} variant="lime">
                    {c.name}
                  </Badge>
                ))}
                {unlimited.map((p) => (
                  <Badge key={p.id} variant="success">
                    {p.planName}
                  </Badge>
                ))}
              </span>
            ) : (
              "None yet"
            )
          }
          hint={clubs.length ? `Member of ${clubs.length} ${clubs.length === 1 ? "club" : "clubs"}` : "You join a club when you buy a pass there"}
        />
      </div>

      <section aria-labelledby="schedule" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="schedule" className="text-lg font-semibold">
            Next 30 days
          </h2>
          <span className="flex gap-3">
            <Link href="/dashboard/student/book" className="text-sm font-medium text-accent-text hover:underline">
              Book a court
            </Link>
            <Link href="/dashboard/student/open-matches" className="text-sm font-medium text-accent-text hover:underline">
              Find a match
            </Link>
          </span>
        </div>
        {feed.length === 0 ? (
          <EmptyState>Nothing booked yet. Join an open match or book a coach.</EmptyState>
        ) : (
          <ol className="space-y-3">
            {feed.map((b) => (
              <li key={`${b.kind}-${b.id}`}>
                <BookingCard booking={b} policy={policyFor(b.clubId, b.policyId)} />
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
