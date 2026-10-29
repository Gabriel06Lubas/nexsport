import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";

import { CtaBand } from "@/components/marketing/cta-band";
import { InviteDemo } from "@/components/marketing/demos/invite-demo";
import { FeatureList } from "@/components/marketing/feature-list";
import { ChatMock } from "@/components/marketing/mockups/chat-mock";
import { FeedMock } from "@/components/marketing/mockups/feed-mock";
import { NotificationsMock } from "@/components/marketing/mockups/notifications-mock";
import { ProfileMock } from "@/components/marketing/mockups/profile-mock";
import { PageHero, Section, SectionHeading } from "@/components/marketing/section";
import { ButtonLink } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "For athletes",
  description: "Accept session invites, chat with your coach and squad, and share your sports life on your nexport profile.",
};

export default function AthletesPage() {
  return (
    <>
      <PageHero
        eyebrow="For athletes & students"
        title="Your training, your team, your highlights."
        description="Say yes to a session in one tap, pay in the same step, chat with your squad, and keep a profile of the sports you love."
      >
        <ButtonLink href="/pricing" size="lg">
          Join for free <ArrowRight />
        </ButtonLink>
      </PageHero>

      <Section>
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2">
          <div>
            <SectionHeading
              eyebrow="Try it: session invites"
              title="In or out? One tap."
              description="When your coach invites you, you see the time, the court and how many seats are left. Accept and pay together, or decline so your seat goes to someone on the waitlist."
            />
            <FeatureList
              className="mt-8"
              items={["See seats left before you accept", "Pay securely by card", "Join the waitlist when it's full", "Automatic refunds if you cancel in time"]}
            />
          </div>
          <InviteDemo />
        </div>
      </Section>

      <Section className="border-y border-border bg-muted/40">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2">
          <ChatMock />
          <div className="lg:order-first">
            <SectionHeading
              eyebrow="Messaging"
              title="Talk to your coach and your squad."
              description="Message your coach directly, or chat with your whole training group. Squad chats belong to the club, so the right people are always in them."
            />
            <FeatureList className="mt-8" items={["Direct messages", "Squad group chats", "See who has read the latest", "Mute busy chats"]} />
          </div>
        </div>
      </Section>

      <Section>
        <SectionHeading
          eyebrow="Social"
          title="A profile built for sport."
          description="List the sports you play and your level, follow teammates and clubs, and share results, clips and photos with whoever you choose."
        />
        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <ProfileMock />
          <FeedMock />
          <NotificationsMock />
        </div>
        <FeatureList
          className="mt-10 lg:grid-cols-3"
          items={["Private profiles with follow requests", "Posts for everyone, followers, your club or just you", "Likes and threaded comments", "Photos and video", "Notifications for what matters", "Follow your favourite clubs"]}
        />
      </Section>

      <CtaBand title="Your club is waiting for you." description="Create your free profile and accept your first invite." />
    </>
  );
}
