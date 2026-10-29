import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";

import { CtaBand } from "@/components/marketing/cta-band";
import { AttendanceDemo } from "@/components/marketing/demos/attendance-demo";
import { BookingConflictDemo } from "@/components/marketing/demos/booking-conflict-demo";
import { FeeSplitCalculator } from "@/components/marketing/demos/fee-split-calculator";
import { FeatureList } from "@/components/marketing/feature-list";
import { PageHero, Section, SectionHeading } from "@/components/marketing/section";
import { ButtonLink } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "For coaches",
  description: "Schedule sessions with the right court and kit, invite athletes, track attendance, give feedback and get paid automatically.",
};

const steps = [
  { n: "01", title: "Plan", text: "Pick a free court and the kit you need. Conflicts are flagged before you save." },
  { n: "02", title: "Invite", text: "Invite athletes or a whole squad. They accept, pay and get it in their calendar." },
  { n: "03", title: "Coach", text: "Mark attendance at the court, rate performance and leave private feedback." },
  { n: "04", title: "Get paid", text: "Your share of every booking goes to your own Stripe account automatically." },
];

export default function CoachesPage() {
  return (
    <>
      <PageHero
        eyebrow="For coaches"
        title="Spend your time coaching, not organising."
        description="Book courts and kit, fill your sessions, take attendance and get paid. Works for club coaches and independent coaches alike, and it's free to start."
      >
        <ButtonLink href="/login" size="lg">
          Start free <ArrowRight />
        </ButtonLink>
        <ButtonLink href="/features#scheduling" variant="outline" size="lg">
          Scheduling features
        </ButtonLink>
      </PageHero>

      <Section>
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s) => (
            <li key={s.n} className="rounded-2xl border border-border bg-card p-6">
              <span className="font-mono text-sm text-accent-text">{s.n}</span>
              <h2 className="mt-3 text-xl font-semibold">{s.title}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{s.text}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section className="border-y border-border bg-muted/40">
        <SectionHeading
          eyebrow="Try it: session planning"
          title="The court and the kit, checked together."
          description="Choose a facility, a time and your equipment. If the court is taken, the ball machine is out, or there aren't enough balls, you'll know before you save."
        />
        <div className="mt-10">
          <BookingConflictDemo />
        </div>
        <FeatureList
          className="mt-10 lg:grid-cols-3"
          items={["Recurring weekly series", "Seat limits and waitlists", "Rescheduling moves your kit too", "Sport and age group on every session", "Set a price or keep it free", "Cancel with automatic refunds"]}
        />
      </Section>

      <Section>
        <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-[1fr_1.3fr]">
          <SectionHeading
            eyebrow="Try it: attendance & feedback"
            title="Take the register in ten seconds."
            description="Mark each athlete present, late, absent or excused, rate their session from 1 to 5, and leave notes that only they can see. Over a season, that becomes a record of their progress."
          />
          <AttendanceDemo />
        </div>
      </Section>

      <Section className="border-t border-border">
        <SectionHeading
          eyebrow="Try it: your payout"
          title="See exactly what you earn per session."
          description="Clubs set your share of each booking. Independent coaches keep everything after the platform fee and card processing."
        />
        <div className="mt-10">
          <FeeSplitCalculator />
        </div>
      </Section>

      <CtaBand title="Your next session, booked in a minute." description="Free for coaches. Upgrade when you're ready to lower your fees." />
    </>
  );
}
