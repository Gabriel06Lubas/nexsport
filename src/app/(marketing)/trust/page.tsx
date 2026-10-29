import { CalendarX2, CreditCard, KeyRound, Lock, Repeat2, Users } from "lucide-react";
import type { Metadata } from "next";

import { CtaBand } from "@/components/marketing/cta-band";
import { PageHero, Section, SectionHeading } from "@/components/marketing/section";

export const metadata: Metadata = {
  title: "Trust & reliability",
  description: "How nexport prevents double-bookings, keeps club data separate and handles payments safely.",
};

const guarantees = [
  {
    icon: CalendarX2,
    title: "A court can’t be booked twice",
    text: "Overlapping sessions on the same facility are rejected by the database itself, not just the app. Even if two coaches press “save” at exactly the same moment, only one booking goes through. Back-to-back sessions (10:00–11:00, then 11:00–12:00) are fine.",
  },
  {
    icon: Repeat2,
    title: "Equipment can’t be over-promised",
    text: "Each booking reserves a number of units, and the total reserved at any moment can never exceed your stock. That holds for a single ball machine or forty ball tubes, and it stays true when a session is rescheduled.",
  },
  {
    icon: Users,
    title: "Sessions can’t go over capacity",
    text: "Seat limits are enforced the same way, so a session never confirms more athletes than you allowed. Extra athletes go on the waitlist.",
  },
  {
    icon: CreditCard,
    title: "No double charges",
    text: "Each seat can have only one live payment. If an athlete’s connection drops and checkout is retried, they are never charged twice.",
  },
  {
    icon: Lock,
    title: "Clubs are kept apart",
    text: "Every club’s facilities, equipment and sessions are tied to that club. A session in one club can never point at another club’s court or kit.",
  },
  {
    icon: KeyRound,
    title: "Access by role",
    text: "Owners, staff, coaches and athletes each see only what they need, and staff permissions are granted one by one.",
  },
];

export default function TrustPage() {
  return (
    <>
      <PageHero
        eyebrow="Trust & reliability"
        title="The things that must never go wrong, can’t."
        description="Double-bookings, overbooked sessions and double charges are blocked at the deepest layer of nexport, and we test them under real concurrent load."
      />

      <Section>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {guarantees.map((g) => (
            <div key={g.title} className="rounded-2xl border border-border bg-card p-6">
              <g.icon className="size-6 text-accent-text" aria-hidden />
              <h2 className="mt-4 text-lg font-semibold">{g.title}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{g.text}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section className="border-t border-border bg-muted/40">
        <div className="grid gap-12 lg:grid-cols-2">
          <SectionHeading
            eyebrow="Payments"
            title="Card data never touches our servers."
            description="Payments run on Stripe. Athletes enter card details in Stripe’s secure checkout, and clubs and coaches are paid through Stripe Connect into their own accounts after Stripe verifies their identity."
          />
          <ul className="space-y-4 text-sm">
            {[
              ["Verified payouts", "Clubs and coaches complete Stripe’s identity checks before they can receive money."],
              ["Transparent splits", "Every payment records the platform fee, card processing and each payout."],
              ["Refund history", "Refunds record the policy that applied at the time, even if the policy changes later."],
              ["Dispute tracking", "Chargebacks are tracked from the first warning to the final outcome."],
            ].map(([t, d]) => (
              <li key={t} className="rounded-xl border border-border bg-card p-4">
                <p className="font-semibold">{t}</p>
                <p className="mt-1 text-muted-foreground">{d}</p>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      <CtaBand />
    </>
  );
}
