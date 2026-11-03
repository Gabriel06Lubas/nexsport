import { eq } from "drizzle-orm";
import { Check } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ActionButton } from "@/components/forms/action-form";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { planCurrency, pricingCards, type PricingCard } from "@/config/pricing";
import { db } from "@/db";
import { profile } from "@/db/schema";
import { getCoachEntitlements } from "@/lib/entitlements";
import { formatMoney } from "@/lib/utils";
import { requireUser } from "@/modules/auth/dal";
import { homePathFor } from "@/modules/auth/lib/roles";
import { startCoachProCheckout } from "@/modules/onboarding/actions";
import { countryOptions, currencyOptions, timeZoneOptions } from "@/modules/onboarding/club-options";
import { ClubCheckoutForm } from "@/modules/onboarding/components/club-checkout-form";

export const metadata: Metadata = { title: "Choose your plan" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const price = (c: PricingCard) => formatMoney(c.monthlyPriceAmount, planCurrency).replace(/\.00$/, "");

function Features({ card }: { card: PricingCard }) {
  return (
    <>
      {card.includesPrevious && <p className="mt-4 text-xs font-medium">{card.includesPrevious}</p>}
      <ul className="mt-2 space-y-1.5">
        {card.features.map((f) => (
          <li key={f} className="flex gap-2 text-sm">
            <Check className="mt-0.5 size-4 shrink-0 text-accent-text" aria-hidden /> {f}
          </li>
        ))}
      </ul>
    </>
  );
}

// Step 2 of 3: the plan. Coaches are already Free Coaches and may upgrade;
// club owners must pick a paid plan, and pay, before anything is created.
export default async function PlanPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  if (user.role === "ADMIN") redirect("/admin");
  const cancelled = (await searchParams).checkout === "cancelled";

  if (user.role === "COACH" && user.onboarded) {
    if ((await getCoachEntitlements(user.id)).tier === "PRO_COACH") redirect("/dashboard/coach");
    const free = pricingCards.find((c) => c.id === "FREE_COACH")!;
    const pro = pricingCards.find((c) => c.id === "PRO_COACH")!;
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-accent-text">Step 2 of 3 · Your plan</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">How do you want to coach?</h1>
          <p className="mt-2 text-muted-foreground">Start on Free Coach and upgrade any time.</p>
        </div>
        {cancelled && <p role="status" className="rounded-2xl border border-border bg-card px-4 py-3 text-sm">Payment not completed. You&apos;re on Free Coach; you can upgrade whenever you like.</p>}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <section aria-label="Free Coach plan" className="flex flex-col rounded-2xl border border-border bg-card p-6">
            <h2 className="text-lg font-semibold">{free.name}</h2>
            <p className="mt-2 text-3xl font-semibold">{price(free)}<span className="text-sm font-normal text-muted-foreground">/mo</span></p>
            <Features card={free} />
            <ButtonLink href="/dashboard/coach" variant="outline" className="mt-6">
              Continue with Free Coach
            </ButtonLink>
          </section>
          <section aria-label="Pro Coach plan" className="flex flex-col rounded-2xl border border-ink bg-card p-6 ring-1 ring-ink">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">{pro.name}</h2>
              {pro.badge && <Badge variant="lime">{pro.badge}</Badge>}
            </div>
            <p className="mt-2 text-3xl font-semibold">{price(pro)}<span className="text-sm font-normal text-muted-foreground">/mo</span></p>
            <Features card={pro} />
            <div className="mt-6">
              <ActionButton action={startCoachProCheckout} hidden={{ from: "onboarding" }} variant="primary" pendingLabel="Opening Stripe…">
                Upgrade to Pro Coach
              </ActionButton>
            </div>
          </section>
        </div>
      </div>
    );
  }

  // Club owner signup: an account that isn't onboarded yet, with a profile.
  if (!user.onboarded && user.role === "STUDENT") {
    const [own] = await db.select({ id: profile.id }).from(profile).where(eq(profile.userId, user.id));
    if (!own) redirect("/onboarding");
    const clubPlans = pricingCards.filter((c) => c.segment === "clubs");
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-accent-text">Step 2 of 3 · Your club&apos;s plan</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Choose a plan for your club</h1>
          <p className="mt-2 text-muted-foreground">Club accounts start with a paid plan. Your club is created as soon as the payment goes through.</p>
        </div>
        {cancelled && <p role="status" className="rounded-2xl border border-border bg-card px-4 py-3 text-sm">Payment not completed, so no club was created. Pick a plan to try again.</p>}
        <div className="rounded-3xl border border-border bg-card p-6 sm:p-8">
          <ClubCheckoutForm
            plans={clubPlans}
            priceLabels={Object.fromEntries(clubPlans.map((c) => [c.id, price(c)]))}
            countries={countryOptions}
            timeZones={timeZoneOptions()}
            currencies={currencyOptions}
          />
        </div>
      </div>
    );
  }

  redirect(user.onboarded ? homePathFor(user.role) : "/onboarding");
}
