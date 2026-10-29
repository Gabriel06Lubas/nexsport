import { Check } from "lucide-react";
import type { Metadata } from "next";

import { CtaBand } from "@/components/marketing/cta-band";
import { FeeSplitCalculator } from "@/components/marketing/demos/fee-split-calculator";
import { RefundCalculator } from "@/components/marketing/demos/refund-calculator";
import { PageHero, Section, SectionHeading } from "@/components/marketing/section";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { tiers } from "@/config/pricing";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Free for coaches. Monthly plans for clubs lower the platform fee on every session booking.",
};

const faqs = [
  {
    q: "What is the platform fee?",
    a: "A percentage of each paid session booking. It's lower on higher plans. Free sessions carry no fee.",
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
      <PageHero
        eyebrow="Pricing"
        title="Start free. Pay less as you grow."
        description="Every plan includes scheduling, payments, messaging and the social network. Higher plans add club tools and lower the fee on each booking."
      />

      <Section className="pt-12 sm:pt-16">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {tiers.map((t) => (
            <div
              key={t.id}
              className={cn("flex flex-col rounded-2xl border bg-card p-6", t.featured ? "border-ink ring-1 ring-ink" : "border-border")}
            >
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">{t.name}</h2>
                {t.featured && <Badge variant="lime">Most popular</Badge>}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{t.audience}</p>
              <p className="mt-6">
                {t.monthly === null ? (
                  <span className="text-4xl font-semibold">Custom</span>
                ) : (
                  <>
                    <span className="text-4xl font-semibold tabular-nums">€{t.monthly}</span>
                    <span className="text-sm text-muted-foreground"> / month</span>
                  </>
                )}
              </p>
              <p className="mt-1 text-sm">
                {t.platformFeeBps === null ? "Custom platform fee" : `${t.platformFeeBps / 100}% platform fee per paid booking`}
              </p>
              <ul className="mt-6 flex-1 space-y-2.5">
                {t.highlights.map((h) => (
                  <li key={h} className="flex gap-2 text-sm">
                    <Check className="mt-0.5 size-4 shrink-0 text-accent-text" aria-hidden /> {h}
                  </li>
                ))}
              </ul>
              <ButtonLink href="/contact" variant={t.featured ? "primary" : "outline"} className="mt-8">
                {t.cta}
              </ButtonLink>
            </div>
          ))}
        </div>
        <p className="mt-6 text-center text-sm text-muted-foreground">Prices exclude VAT. Card processing is charged by Stripe at its standard rates.</p>
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
