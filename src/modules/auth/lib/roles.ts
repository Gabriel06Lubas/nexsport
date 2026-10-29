import type { UserRole } from "@/db/schema/enums";

// Role-based access to the dashboard areas (the RBAC table from the spec).
// ADMIN runs the platform from /admin and can also open every area.

export type DashboardArea = "club" | "coach" | "athlete";

export const areaRoles: Record<DashboardArea, readonly UserRole[]> = {
  club: ["ADMIN", "CLUB_OWNER", "STAFF"],
  coach: ["ADMIN", "COACH"],
  athlete: ["ADMIN", "STUDENT"],
};

export const areaPaths = {
  club: "/dashboard/club",
  coach: "/dashboard/coach",
  athlete: "/dashboard/athlete",
} as const satisfies Record<DashboardArea, string>;

const homeArea: Record<Exclude<UserRole, "ADMIN">, DashboardArea> = {
  CLUB_OWNER: "club",
  STAFF: "club",
  COACH: "coach",
  STUDENT: "athlete",
};

export function canAccessArea(role: UserRole, area: DashboardArea): boolean {
  return areaRoles[area].includes(role);
}

export function homePathFor(role: UserRole) {
  return role === "ADMIN" ? ("/admin" as const) : areaPaths[homeArea[role]];
}

/** Roles a user may pick for themselves during onboarding. STAFF is granted
 *  by a club; ADMIN is only ever set directly in the database. */
export const selfAssignableRoles = ["STUDENT", "COACH", "CLUB_OWNER"] as const satisfies readonly UserRole[];
export type SelfAssignableRole = (typeof selfAssignableRoles)[number];
