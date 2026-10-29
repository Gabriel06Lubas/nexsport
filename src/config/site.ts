import type { Route } from "next";

export const siteConfig = {
  name: "nexport",
  tagline: "Run your club. Coach your athletes. Grow your community.",
  description:
    "nexport is the all-in-one platform for sports clubs, coaches and athletes: courts and fields, equipment, scheduling, payments and a social network built for sport.",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  // Placeholder inbox: replace before launch.
  contactEmail: "hello@nexport.app",
};

export type NavItem = { href: Route; label: string; description?: string };

export const audienceNav: NavItem[] = [
  { href: "/clubs", label: "For clubs", description: "Facilities, staff, members and revenue in one dashboard" },
  { href: "/coaches", label: "For coaches", description: "Schedule sessions, track attendance, get paid" },
  { href: "/athletes", label: "For athletes", description: "Invites, team chat and your sports profile" },
];

export const mainNav: NavItem[] = [
  { href: "/features", label: "Features" },
  { href: "/sports", label: "Sports" },
  { href: "/pricing", label: "Pricing" },
  { href: "/trust", label: "Trust" },
];

export const footerNav: { title: string; items: NavItem[] }[] = [
  { title: "Product", items: [{ href: "/features", label: "All features" }, { href: "/pricing", label: "Pricing" }, { href: "/sports", label: "Sports" }] },
  { title: "Who it's for", items: audienceNav },
  { title: "Company", items: [{ href: "/trust", label: "Trust & reliability" }, { href: "/contact", label: "Contact" }] },
];
