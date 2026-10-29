import { ArrowRight, Check } from "lucide-react";
import Link from "next/link";

import { CtaBand } from "@/components/marketing/cta-band";
import { BookingConflictDemo } from "@/components/marketing/demos/booking-conflict-demo";
import { FeeSplitCalculator } from "@/components/marketing/demos/fee-split-calculator";
import { InviteDemo } from "@/components/marketing/demos/invite-demo";
import { ChatMock } from "@/components/marketing/mockups/chat-mock";
import { DashboardMock } from "@/components/marketing/mockups/dashboard-mock";
import { FeedMock } from "@/components/marketing/mockups/feed-mock";
import { Section, SectionHeading } from "@/components/marketing/section";
import { SportsStrip } from "@/components/marketing/sports-strip";
import { ButtonLink } from "@/components/ui/button";
import { featureGroups } from "@/config/features";
import { audienceNav } from "@/config/site";

const audiencePoints: Record<string, string[]> = {
  "/clubs": ["Dashboard for revenue, members & utilisation", "Facilities, equipment, sports & age groups", "Staff roles, permissions & coach assignment"],
  "/coaches": ["Book a court and kit in one step", "Invites, attendance & athlete feedback", "Automatic payouts to your Stripe account"],
  "/athletes": ["Accept or decline session invites", "Direct and squad group chat", "Your sports profile, feed and followers"],
};

export default function HomePage() {
  return (
    <>
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(55%_45%_at_85%_10%,color-mix(in_oklab,var(--lime)_30%,transparent),transparent),radial-gradient(40%_40%_at_0%_100%,color-mix(in_oklab,var(--chart-1)_12%,transparent),transparent)]"
        />
        <div className="relative mx-auto grid max-w-7xl grid-cols-1 items-center gap-12 px-4 pb-16 pt-14 sm:px-6 sm:pt-20 lg:grid-cols-[1fr_1.1fr] lg:pb-24">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
              <span className="size-1.5 rounded-full bg-chart-1" aria-hidden /> Football · Padel · Tennis · Fitness · Multi-sport
            </p>
            <h1 className="isolate mt-6 text-5xl font-semibold tracking-tight text-balance sm:text-7xl">
              Where sports clubs <span className="relative whitespace-nowrap">run<span aria-hidden className="absolute inset-x-0 bottom-1 -z-10 h-3 bg-lime sm:h-4" /></span>, and communities play.
            </h1>
            <p className="mt-6 max-w-xl text-lg text-muted-foreground text-pretty sm:text-xl">
              nexport brings courts, kit, coaches, athletes, payments and a social feed into one platform. Club owners see the whole
              business, coaches run their sessions, and athletes just show up and play.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="/pricing" size="lg">
                Get started free <ArrowRight />
              </ButtonLink>
              <ButtonLink href="/features" variant="outline" size="lg">
                See every feature
              </ButtonLink>
            </div>
            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
              {["No double-bookings, ever", "Automatic coach payouts", "Free plan for coaches"].map((t) => (
                <li key={t} className="flex items-center gap-1.5">
                  <Check className="size-4 text-accent-text" aria-hidden /> {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="relative min-w-0">
            <DashboardMock compact />
            <div className="relative -mt-10 ml-auto hidden w-[85%] sm:block lg:-ml-16 lg:mr-0">
              <div className="rounded-2xl bg-background p-1.5">
                <InviteDemo />
              </div>
            </div>
          </div>
        </div>
      </section>

      <SportsStrip />

      <Section>
        <SectionHeading eyebrow="One platform, three experiences" title="Built for everyone who makes a club work." />
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {audienceNav.map((a) => (
            <Link key={a.href} href={a.href} className="group rounded-2xl border border-border bg-card p-6 transition-colors hover:border-foreground/30">
              <h3 className="text-xl font-semibold">{a.label}</h3>
              <p className="mt-2 text-muted-foreground">{a.description}</p>
              <ul className="mt-5 space-y-2.5">
                {audiencePoints[a.href]?.map((p) => (
                  <li key={p} className="flex gap-2 text-sm">
                    <Check className="mt-0.5 size-4 shrink-0 text-accent-text" aria-hidden /> {p}
                  </li>
                ))}
              </ul>
              <span className="mt-6 inline-flex items-center gap-1 text-sm font-semibold">
                Learn more <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </span>
            </Link>
          ))}
        </div>
      </Section>

      <Section className="border-y border-border bg-muted/40">
        <SectionHeading
          eyebrow="Try it: scheduling"
          title="Book a court and the kit. Never twice."
          description="Pick a court, a time and the equipment you need. nexport checks the facility, the stock and the timing before anything is confirmed. Try booking over an existing session."
        />
        <div className="mt-10">
          <BookingConflictDemo />
        </div>
      </Section>

      <Section>
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <SectionHeading
              eyebrow="Social & messaging"
              title="Your club’s community, not just its calendar."
              description="Every member gets a sports profile. Clubs and coaches share results, athletes celebrate wins, and squads chat in group threads tied to the club."
            />
            <ul className="mt-8 grid gap-3 sm:grid-cols-2">
              {["Posts with photos & video", "Likes & threaded comments", "Follow athletes & clubs", "Private profiles", "Direct messages", "Squad group chats"].map((t) => (
                <li key={t} className="flex items-center gap-2 text-sm">
                  <Check className="size-4 text-accent-text" aria-hidden /> {t}
                </li>
              ))}
            </ul>
            <ButtonLink href="/athletes" variant="outline" className="mt-8">
              Explore the athlete experience <ArrowRight />
            </ButtonLink>
          </div>
          <div className="grid min-w-0 items-start gap-4 sm:grid-cols-2">
            <FeedMock />
            <ChatMock />
          </div>
        </div>
      </Section>

      <Section className="border-y border-border bg-muted/40">
        <SectionHeading
          eyebrow="Try it: payments"
          title="Athletes pay once. Everyone gets their share."
          description="Payments run through Stripe Connect. Set the coach’s share once, and every booking is split between the club, the coach and the platform automatically."
        />
        <div className="mt-10">
          <FeeSplitCalculator />
        </div>
      </Section>

      <Section>
        <SectionHeading eyebrow="Everything in one place" title="Ten modules. One login." description="Each one works on its own, and they all work better together." />
        <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-5">
          {featureGroups.map((g) => (
            <Link key={g.id} href={`/features#${g.id}`} className="group bg-card p-5 transition-colors hover:bg-muted">
              <g.icon className="size-5 text-accent-text" aria-hidden />
              <h3 className="mt-4 font-semibold">{g.title}</h3>
              <p className="mt-1.5 text-sm text-muted-foreground">{g.summary}</p>
            </Link>
          ))}
        </div>
        <div className="mt-8 flex justify-center">
          <ButtonLink href="/features" variant="outline">
            Browse all capabilities <ArrowRight />
          </ButtonLink>
        </div>
      </Section>

      <CtaBand />
    </>
  );
}
