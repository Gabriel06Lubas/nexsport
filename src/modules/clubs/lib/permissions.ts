import type { ClubPermission } from "@/db/schema/enums";

// Who can do what inside a club dashboard. OWNER holds every permission;
// STAFF hold the ones granted on their ClubMember row. Shared by the server
// (DAL and actions) and the sidebar, which hides sections a member can't open.

export const allClubPermissions = [
  "MANAGE_CLUB_SETTINGS",
  "MANAGE_FACILITIES",
  "MANAGE_EQUIPMENT",
  "MANAGE_MEMBERS",
  "MANAGE_SCHEDULE",
  "MANAGE_BILLING",
  "VIEW_ANALYTICS",
  "MANAGE_SOCIAL",
] as const satisfies readonly ClubPermission[];

export const permissionLabels: Record<ClubPermission, string> = {
  MANAGE_CLUB_SETTINGS: "Club settings",
  MANAGE_FACILITIES: "Facilities & pricing",
  MANAGE_EQUIPMENT: "Equipment & maintenance",
  MANAGE_MEMBERS: "Members, passes & staff roster",
  MANAGE_SCHEDULE: "Bookings & schedule",
  MANAGE_BILLING: "Billing, payroll & payouts",
  VIEW_ANALYTICS: "Analytics",
  MANAGE_SOCIAL: "Social & posts",
};

export type ClubSection = "overview" | "facilities" | "staff" | "memberships" | "schedule" | "billing";

export const clubSections: { key: ClubSection; path: string; label: string; anyOf: readonly ClubPermission[] }[] = [
  { key: "overview", path: "", label: "Overview", anyOf: [] },
  { key: "facilities", path: "/facilities", label: "Facilities & Courts", anyOf: ["MANAGE_FACILITIES", "MANAGE_EQUIPMENT"] },
  { key: "staff", path: "/staff", label: "Staff & Payroll", anyOf: ["MANAGE_MEMBERS", "MANAGE_BILLING"] },
  { key: "memberships", path: "/memberships", label: "Memberships & Passes", anyOf: ["MANAGE_MEMBERS"] },
  { key: "schedule", path: "/schedule", label: "Bookings & Schedule", anyOf: ["MANAGE_SCHEDULE"] },
  { key: "billing", path: "/billing", label: "Billing & Stripe Connect", anyOf: ["MANAGE_BILLING"] },
];

export type ClubGrant = { role: "OWNER" | "STAFF"; permissions: readonly ClubPermission[] };

export function hasPermission(grant: ClubGrant, permission: ClubPermission): boolean {
  return grant.role === "OWNER" || grant.permissions.includes(permission);
}

export function canOpenSection(grant: ClubGrant, section: ClubSection): boolean {
  const def = clubSections.find((s) => s.key === section);
  return !!def && (def.anyOf.length === 0 || def.anyOf.some((p) => hasPermission(grant, p)));
}

/**
 * Slugs that can't name a club: they are static routes under /dashboard
 * (Next.js matches those before /dashboard/[clubSlug]), or would read as one.
 */
export const reservedClubSlugs = new Set(["club", "coach", "athlete", "settings", "admin", "new", "api", "login", "onboarding"]);

export const clubSlugPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** "Padel Central Valencia!" → "padel-central-valencia". */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
}
