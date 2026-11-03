import type { SubscriptionTier } from "@/db/schema/enums";

import plansFile from "./plans.json";

// The pricing page: who each plan is for, what it includes, and where its
// button goes. Numbers (price, platform fee, limits) come from plans.json,
// the same file migration 0011 and `npm run stripe:plans` use, so the page,
// the database and Stripe can't disagree.

export type PlanFacts = {
  tier: SubscriptionTier;
  name: string;
  audience: "COACH" | "CLUB";
  monthlyPriceAmount: number;
  platformFeeBps: number;
  limits: { maxFacilities: number | null; maxStaff: number | null; maxAthletes: number | null };
  stripePriceEnv: string | null;
  features: PlanFeature[];
};

/** Feature flags a plan unlocks; checked on the server by src/lib/entitlements.ts. */
export type PlanFeature =
  | "unlimited_students"
  | "booking_link"
  | "credit_passes"
  | "reminders"
  | "dynamic_pricing"
  | "equipment"
  | "utilization_reports"
  | "advanced_analytics"
  | "payroll"
  | "open_matches"
  | "multi_location"
  | "priority_support";

export const planCurrency = plansFile.currency;
export const planFacts = plansFile.plans as PlanFacts[];
export const planFactsFor = (tier: SubscriptionTier) => planFacts.find((p) => p.tier === tier)!;

const facts = (tier: SubscriptionTier) => planFacts.find((p) => p.tier === tier)!;
const pct = (bps: number) => `${(bps / 100).toLocaleString("en", { maximumFractionDigits: 2 })}%`;

export type Segment = "coaches" | "clubs" | "athletes";

export type PricingCard = {
  id: SubscriptionTier | "ATHLETE_FREE";
  segment: Segment;
  name: string;
  tagline: string;
  /** Minor units per month. */
  monthlyPriceAmount: number;
  badge?: string;
  /** "Everything in Free, plus:" */
  includesPrevious?: string;
  features: string[];
  cta: { label: string; href: string };
  featured?: boolean;
};

export const segments: { id: Segment; label: string; short: string; description: string }[] = [
  { id: "coaches", label: "Independent coaches", short: "Coaches", description: "Run your own coaching business: schedule, get paid and grow your roster." },
  { id: "clubs", label: "Clubs & facilities", short: "Clubs", description: "Courts, fields, staff, memberships and payouts for sports facilities." },
  { id: "athletes", label: "Athletes", short: "Athletes", description: "Book courts and coaches, join open matches and manage your passes." },
];

const free = facts("FREE_COACH");
const pro = facts("PRO_COACH");
const basic = facts("CLUB_BASIC");
const enterprise = facts("CLUB_ENTERPRISE");

export const pricingCards: PricingCard[] = [
  {
    id: "FREE_COACH",
    segment: "coaches",
    name: free.name,
    tagline: "Everything you need to start coaching on nexport.",
    monthlyPriceAmount: free.monthlyPriceAmount,
    features: [
      "1 Coach License",
      `Up to ${free.limits.maxAthletes} active students`,
      "Basic practice session scheduling (private sessions)",
      "Attendance tracking (Present / Absent / Late)",
      `Standard Stripe Connect processing (${pct(free.platformFeeBps)} platform fee)`,
    ],
    cta: { label: "Start free", href: "/login?plan=FREE_COACH" },
  },
  {
    id: "PRO_COACH",
    segment: "coaches",
    name: pro.name,
    tagline: "For full-time coaches who sell sessions online.",
    monthlyPriceAmount: pro.monthlyPriceAmount,
    badge: "Popular for Coaches",
    featured: true,
    includesPrevious: `Everything in ${free.name.replace(" Coach", "")}, plus:`,
    features: [
      "Unlimited active students",
      "Public self-serve booking URL (nexport.com/coach/your-name)",
      "Session credit passes & punch card sales",
      `Reduced platform fee (${pct(pro.platformFeeBps)})`,
      "Automated email & in-app reminders",
    ],
    cta: { label: "Get Pro Coach", href: "/login?plan=PRO_COACH" },
  },
  {
    id: "CLUB_BASIC",
    segment: "clubs",
    name: basic.name,
    tagline: "Run a club or facility from one dashboard.",
    monthlyPriceAmount: basic.monthlyPriceAmount,
    badge: "Popular for Clubs",
    featured: true,
    features: [
      `Up to ${basic.limits.maxFacilities} courts or fields`,
      "Multi-role team access (Owners & Staff)",
      "Dynamic pricing engine (peak vs. off-peak hourly rates)",
      "Equipment inventory tracking & maintenance logs",
      "Facility utilization metrics & revenue reports",
    ],
    cta: { label: "Get Club Basic", href: "/login?plan=CLUB_BASIC" },
  },
  {
    id: "CLUB_ENTERPRISE",
    segment: "clubs",
    name: enterprise.name,
    tagline: "For multi-court venues, academies and chains.",
    monthlyPriceAmount: enterprise.monthlyPriceAmount,
    includesPrevious: `Everything in ${basic.name.replace("Club ", "")}, plus:`,
    features: [
      "Unlimited courts, fields, and locations",
      "Advanced analytics & occupancy heatmaps",
      "Staff payroll & coach commission split tracking",
      "Open match split-payment system",
      "Priority support & dedicated onboarding",
    ],
    cta: { label: "Get Club Enterprise", href: "/login?plan=CLUB_ENTERPRISE" },
  },
  {
    id: "ATHLETE_FREE",
    segment: "athletes",
    name: "Free",
    tagline: "Always free for players. Pay only for what you book.",
    monthlyPriceAmount: 0,
    features: [
      "Free account creation",
      "Pay-per-booking court rentals & private coaching",
      "Open match finder with split payment checkout",
      "Multi-session credit pass management",
    ],
    cta: { label: "Create free account", href: "/login" },
  },
];

/** Plans with a platform fee, for the payout calculator. */
export const feePlans = planFacts.map((p) => ({ tier: p.tier, name: p.name, platformFeeBps: p.platformFeeBps }));
