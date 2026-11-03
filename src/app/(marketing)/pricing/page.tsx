import type { Metadata } from "next";

import { CtaBand } from "@/components/marketing/cta-band";
import { FeeSplitCalculator } from "@/components/marketing/demos/fee-split-calculator";
import { RefundCalculator } from "@/components/marketing/demos/refund-calculator";
import { PricingTabs } from "@/components/marketing/pricing-tabs";
import { PageHero, Section, SectionHeading } from "@/components/marketing/section";
import { planCurrency, planFacts, pricingCards, segments } from "@/config/pricing";
import { siteConfig } from "@/config/site";

const planPrice = (minor: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: planCurrency.toUpperCase(), minimumFractionDigits: 0 }).format(minor / 100);
const priceOf = (tier: string) => planPrice(planFacts.find((p) => p.tier === tier)!.monthlyPriceAmount);

export const metadata: Metadata = {
  title: "Pricing",
  description: `Free for coaches and athletes. Pro Coach ${priceOf("PRO_COACH")}/mo, Club Basic ${priceOf("CLUB_BASIC")}/mo, Club Enterprise ${priceOf("CLUB_ENTERPRISE")}/mo. Lower platform fees on higher plans.`,
  alternates: { canonical: "/pricing" },
  openGraph: {
    title: "nexport pricing",
    description: `Free Coach, Pro Coach (${priceOf("PRO_COACH")}/mo), Club Basic (${priceOf("CLUB_BASIC")}/mo) and Club Enterprise (${priceOf("CLUB_ENTERPRISE")}/mo). Always free for athletes.`,
    url: "/pricing",
  },
};

/** schema.org offers for search engines: one Offer per plan, monthly. */
function structuredData() {
  const data = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: "nexport",
    description: siteConfig.description,
    brand: { "@type": "Brand", name: "nexport" },
    offers: pricingCards.map((c) => ({
      "@type": "Offer",
      name: c.id === "ATHLETE_FREE" ? "Athlete (Free)" : c.name,
      price: (c.monthlyPriceAmount / 100).toFixed(2),
      priceCurrency: planCurrency.toUpperCase(),
      priceSpecification: { "@type": "UnitPriceSpecification", price: (c.monthlyPriceAmount / 100).toFixed(2), priceCurrency: planCurrency.toUpperCase(), unitCode: "MON" },
      url: `${siteConfig.url}/pricing#${c.segment}`,
      description: c.features.join("; "),
    })),
  };
  // JSON in a <script>: escape "<" so no string can close the tag.
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

const feeLine = planFacts.map((p) => `${p.name} ${p.platformFeeBps / 100}%`).join(", ");

const faqs = [
  {
    q: "What is the platform fee?",
    a: `A percentage of each paid booking, taken when the payment is made: ${feeLine}. Free sessions carry no fee, and athletes never pay a subscription.`,
  },
  {
    q: "Who pays card processing fees?",
    a: "Stripe's card fee is taken from the booking before the club and coach shares are paid out. The calculator above shows the full breakdown.",
  },
  {
    q: "How do payouts work?",
    a: "Clubs and independent coaches connect their own Stripe account during onboarding. Their shares are transferred automatically after each payment.",
  },
  {
    q: "What happens when someone cancels?",
    a: "Refunds follow the club's cancellation policy automatically. If the club or coach cancels, athletes are refunded in full by default.",
  },
  {
    q: "Can I change plans later?",
    a: "Yes. Upgrade or downgrade at any time; the new platform fee applies to bookings made after the change.",
  },
];

export default function PricingPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: structuredData() }} />
      <PageHero
        eyebrow="Pricing"
        title="Start free. Pay less as you grow."
        description="Free for athletes and new coaches. Paid plans unlock club tools, online booking and lower fees on every payment."
      />

      <Section className="pt-12 sm:pt-16">
        <PricingTabs segments={segments} cards={pricingCards} currency={planCurrency} />
        <p className="mt-8 text-center text-sm text-muted-foreground">
          Prices in {planCurrency.toUpperCase()}, billed monthly, excluding taxes. Card processing is charged by Stripe at its standard rates.
        </p>
      </Section>

      <Section id="calculator" className="border-y border-border bg-muted/40">
        <SectionHeading
          eyebrow="Payout calculator"
          title="Where every euro of a booking goes."
          description="Pick a plan, set the coach’s share and see the exact split."
        />
        <div className="mt-10">
          <FeeSplitCalculator />
        </div>
      </Section>

      <Section>
        <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-[1fr_1.2fr]">
          <SectionHeading
            eyebrow="Cancellation policies"
            title="Refunds that follow your rules, automatically."
            description="Each club picks or builds its own policy. When an athlete cancels, nexport checks how much notice they gave and refunds the right amount without anyone lifting a finger."
          />
          <RefundCalculator />
        </div>
      </Section>

      <Section className="border-t border-border">
        <SectionHeading eyebrow="FAQ" title="Questions about pricing" />
        <div className="mt-10 divide-y divide-border rounded-2xl border border-border bg-card">
          {faqs.map((f) => (
            <details key={f.q} className="group p-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                {f.q}
                <span aria-hidden className="text-xl text-muted-foreground transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="mt-3 text-sm text-muted-foreground">{f.a}</p>
            </details>
          ))}
        </div>
      </Section>

      <CtaBand />
    </>
  );
}
