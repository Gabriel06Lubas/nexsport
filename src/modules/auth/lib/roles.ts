import type { UserRole } from "@/generated/prisma/enums";

// Role-based access to the dashboard areas (the RBAC table from the spec).
// SUPER_ADMIN can open every area.

export type DashboardArea = "club" | "coach" | "athlete";

export const areaRoles: Record<DashboardArea, readonly UserRole[]> = {
  club: ["SUPER_ADMIN", "CLUB_OWNER", "STAFF"],
  coach: ["SUPER_ADMIN", "COACH"],
  athlete: ["SUPER_ADMIN", "STUDENT"],
};

export const areaPaths = {
  club: "/dashboard/club",
  coach: "/dashboard/coach",
  athlete: "/dashboard/athlete",
} as const satisfies Record<DashboardArea, string>;

const homeArea: Record<UserRole, DashboardArea> = {
  SUPER_ADMIN: "club",
  CLUB_OWNER: "club",
  STAFF: "club",
  COACH: "coach",
  STUDENT: "athlete",
};

export function canAccessArea(role: UserRole, area: DashboardArea): boolean {
  return areaRoles[area].includes(role);
}

export function homePathFor(role: UserRole) {
  return areaPaths[homeArea[role]];
}

/** Roles a user may pick for themselves during onboarding. STAFF is granted
 *  by a club, SUPER_ADMIN only by the platform. */
export const selfAssignableRoles = ["STUDENT", "COACH", "CLUB_OWNER"] as const satisfies readonly UserRole[];
export type SelfAssignableRole = (typeof selfAssignableRoles)[number];
