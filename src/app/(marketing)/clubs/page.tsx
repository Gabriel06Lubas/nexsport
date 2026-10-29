import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";

import { CtaBand } from "@/components/marketing/cta-band";
import { FeatureList } from "@/components/marketing/feature-list";
import { EquipmentMock, FacilitiesMock, PermissionsMock } from "@/components/marketing/mockups/assets-mock";
import { DashboardMock } from "@/components/marketing/mockups/dashboard-mock";
import { PageHero, Section, SectionHeading } from "@/components/marketing/section";
import { ButtonLink } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "For clubs",
  description: "Run your club from one dashboard: revenue, memberships, facility utilisation, equipment, staff and coaches.",
};

export default function ClubsPage() {
  return (
    <>
      <PageHero
        eyebrow="For club owners & staff"
        title="The whole club, on one screen."
        description="Revenue, members, courts, kit and people. See how the business is doing and run it day to day, without the spreadsheets."
      >
        <ButtonLink href="/login" size="lg">
          Start a free trial <ArrowRight />
        </ButtonLink>
        <ButtonLink href="/contact" variant="outline" size="lg">
          Book a demo
        </ButtonLink>
      </PageHero>

      <Section>
        <SectionHeading
          eyebrow="Dashboard & analytics"
          title="Know how the club is really doing."
          description="Revenue, active memberships, utilisation per court and output per coach, updated as sessions are booked, paid and delivered."
        />
        <div className="mt-10">
          <DashboardMock />
        </div>
      </Section>

      <Section className="border-y border-border bg-muted/40">
        <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-2">
          <div>
            <SectionHeading
              eyebrow="Asset management"
              title="Every court, field and ball machine."
              description="Describe each facility once (type, surface, lighting, capacity, hourly rate) and track equipment stock and condition. Coaches see live availability when they plan a session."
            />
            <FeatureList
              className="mt-8"
              items={[
                "Pitches, courts, gyms, studios, pools and tracks",
                "Turnover buffers between bookings",
                "Pooled stock (40 balls) and single items (1 machine)",
                "Condition tracking, from new to needs repair",
                "Stock can't drop below what's already reserved",
                "Sports and age groups per club",
              ]}
            />
          </div>
          <div className="grid gap-4">
            <FacilitiesMock />
            <EquipmentMock />
          </div>
        </div>
      </Section>

      <Section>
        <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-2">
          <div className="lg:order-2">
            <SectionHeading
              eyebrow="People management"
              title="The right access for every person."
              description="Invite staff, coaches and athletes. Owners have full control; staff get exactly the permissions you grant, and coaches see their own sessions and athletes."
            />
            <FeatureList
              className="mt-8"
              items={[
                "Roles: owner, staff, coach and athlete",
                "Eight granular staff permissions",
                "Assign coaches to athletes or whole squads",
                "Member status: invited, active, suspended, left",
                "One person can hold several roles",
                "Group athletes by age group and sport",
              ]}
            />
          </div>
          <PermissionsMock />
        </div>
      </Section>

      <Section className="border-t border-border">
        <SectionHeading
          eyebrow="Money"
          title="Get paid without chasing anyone."
          description="Athletes pay by card when they book. Your share lands in the club’s own Stripe account, coaches get theirs automatically, and refunds follow the cancellation policy you set."
        />
        <div className="mt-8 flex flex-wrap gap-3">
          <ButtonLink href="/pricing#calculator" variant="outline">
            Try the payout calculator <ArrowRight />
          </ButtonLink>
          <ButtonLink href="/trust" variant="ghost">
            How we keep money safe
          </ButtonLink>
        </div>
      </Section>

      <CtaBand />
    </>
  );
}
