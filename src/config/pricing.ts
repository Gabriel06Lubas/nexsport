// Marketing copy for the SaaS tiers in the `SubscriptionTier` enum.
// Prices are placeholders until the Stripe Prices are created.

export type Tier = {
  id: "FREE" | "STARTER" | "PRO" | "ENTERPRISE";
  name: string;
  audience: string;
  monthly: number | null; // EUR per month; null = custom
  /** Platform fee on pay-per-session bookings, in basis points (Subscription.platformFeeBps). */
  platformFeeBps: number | null;
  highlights: string[];
  cta: string;
  featured?: boolean;
};

export const tiers: Tier[] = [
  {
    id: "FREE",
    name: "Free",
    audience: "Independent coaches getting started",
    monthly: 0,
    platformFeeBps: 1000,
    highlights: ["1 coach profile", "Unlimited session invites", "Attendance & feedback", "Social profile & feed", "Stripe payouts"],
    cta: "Start free",
  },
  {
    id: "STARTER",
    name: "Starter",
    audience: "Small clubs and coaching teams",
    monthly: 49,
    platformFeeBps: 600,
    highlights: ["Up to 4 facilities", "Up to 10 staff & coaches", "Equipment inventory", "Cancellation policies", "Group messaging"],
    cta: "Start 14-day trial",
  },
  {
    id: "PRO",
    name: "Pro",
    audience: "Established multi-sport clubs",
    monthly: 149,
    platformFeeBps: 300,
    highlights: ["Unlimited facilities", "Unlimited staff & coaches", "Revenue & utilisation analytics", "Granular staff permissions", "Coach revenue splits"],
    cta: "Start 14-day trial",
    featured: true,
  },
  {
    id: "ENTERPRISE",
    name: "Enterprise",
    audience: "Federations, academies and chains",
    monthly: null,
    platformFeeBps: null,
    highlights: ["Multiple clubs, one account", "Custom platform fee", "Custom Stripe Connect setup", "Priority support & onboarding", "Data export"],
    cta: "Talk to us",
  },
];
