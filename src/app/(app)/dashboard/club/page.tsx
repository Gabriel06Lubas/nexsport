import { ChevronRight } from "lucide-react";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { planCurrency, pricingCards } from "@/config/pricing";
import { formatMoney } from "@/lib/utils";
import { requireOnboardedUser } from "@/modules/auth/dal";
import { homePathFor } from "@/modules/auth/lib/roles";
import { listManagedClubs } from "@/modules/clubs/dal";
import { countryOptions, currencyOptions, timeZoneOptions } from "@/modules/onboarding/club-options";
import { ClubCheckoutForm } from "@/modules/onboarding/components/club-checkout-form";

export const metadata: Metadata = { title: "Your clubs" };

const clubPlans = pricingCards.filter((c) => c.segment === "clubs");
const priceLabels = Object.fromEntries(clubPlans.map((c) => [c.id, formatMoney(c.monthlyPriceAmount, planCurrency).replace(/\.00$/, "")]));

// Entry point of the club area: one club → straight to it; several → pick;
// none (or ?new=1) → club owners add one here, by paying for its plan.
export default async function ClubPickerPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireOnboardedUser();
  if (user.role === "ADMIN") redirect("/admin");
  const clubs = await listManagedClubs(user.id);
  // ?new=1: an owner adding a second club stays on this page.
  const params = await searchParams;
  const adding = params.new === "1" && user.role === "CLUB_OWNER";
  const cancelled = params.checkout === "cancelled";
  if (clubs.length === 1 && !adding) redirect(`/dashboard/${clubs[0]!.slug}` as Route);
  // STAFF's home is this page, so redirecting them would loop.
  if (clubs.length === 0 && user.role !== "CLUB_OWNER" && user.role !== "STAFF") redirect(homePathFor(user.role));

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <p className="text-sm font-semibold uppercase tracking-wider text-accent-text">Club dashboard</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{clubs.length || user.role !== "CLUB_OWNER" ? "Your clubs" : "Create your club"}</h1>
        <p className="mt-2 text-muted-foreground">
          {clubs.length
            ? "Pick the club you want to manage."
            : user.role === "CLUB_OWNER"
              ? "Choose a plan and set up your club, then add courts, prices, memberships and your team."
              : "You're not on any club's staff yet. Ask the club owner to add you with this account's email."}
        </p>
      </div>

      {clubs.length > 0 && (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
          {clubs.map((c) => (
            <li key={c.id}>
              <Link href={`/dashboard/${c.slug}` as Route} className="flex items-center gap-3 px-5 py-4 hover:bg-muted/60">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{c.name}</span>
                  <span className="block text-xs text-muted-foreground">{[c.city, `/${c.slug}`].filter(Boolean).join(" · ")}</span>
                </span>
                {c.status !== "ACTIVE" && <Badge variant={c.status === "SUSPENDED" ? "danger" : "warning"}>{c.status === "SUSPENDED" ? "Suspended" : "Setting up"}</Badge>}
                <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {user.role === "CLUB_OWNER" && (
        <section aria-labelledby="new-club" className="rounded-3xl border border-border bg-card p-6 sm:p-8">
          <h2 id="new-club" className="text-lg font-semibold">
            {clubs.length ? "Add another club" : "Club details"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">Each club has its own plan. The club is created once Stripe confirms the first payment.</p>
          {cancelled && (
            <p role="status" className="mt-4 rounded-xl bg-muted px-4 py-3 text-sm">
              Payment cancelled. Nothing was charged and no club was created.
            </p>
          )}
          <div className="mt-6">
            <ClubCheckoutForm plans={clubPlans} priceLabels={priceLabels} countries={countryOptions} timeZones={timeZoneOptions()} currencies={currencyOptions} />
          </div>
        </section>
      )}
    </div>
  );
}
