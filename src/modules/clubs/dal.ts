import "server-only";

import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { notFound } from "next/navigation";
import { cache } from "react";

import { db } from "@/db";
import { club, clubMember } from "@/db/schema";
import type { ClubPermission } from "@/db/schema/enums";
import { requireOnboardedUser, type CurrentUser } from "@/modules/auth/dal";

import { allClubPermissions, canOpenSection, clubSlugPattern, hasPermission, type ClubSection } from "./lib/permissions";

// Tenant gate for /dashboard/[clubSlug]. Access comes from an ACTIVE
// ClubMember row with role OWNER or STAFF in *that* club, never from the
// platform role alone: a CLUB_OWNER of one club is a stranger to every other.
// Anyone without access gets a plain 404, so club slugs can't be probed.
// Admins support clubs by impersonating the owner (see /admin).

export type ClubAccess = {
  user: CurrentUser;
  club: {
    id: string;
    slug: string;
    name: string;
    status: "PENDING_SETUP" | "ACTIVE" | "SUSPENDED" | "ARCHIVED";
    timezone: string;
    currency: string;
    country: string;
    city: string | null;
  };
  role: "OWNER" | "STAFF";
  memberId: string;
  permissions: readonly ClubPermission[];
  /** Suspended by the platform: everything is visible, nothing can change. */
  readOnly: boolean;
};

const loadAccess = cache(async (userId: string, slug: string) => {
  const rows = await db
    .select({
      id: club.id,
      slug: club.slug,
      name: club.name,
      status: club.status,
      timezone: club.timezone,
      currency: club.currency,
      country: club.country,
      city: club.city,
      memberId: clubMember.id,
      role: clubMember.role,
      permissions: clubMember.permissions,
    })
    .from(club)
    .innerJoin(clubMember, eq(clubMember.clubId, club.id))
    .where(
      and(
        eq(club.slug, slug),
        isNull(club.deletedAt),
        ne(club.status, "ARCHIVED"),
        eq(clubMember.userId, userId),
        eq(clubMember.status, "ACTIVE"),
        inArray(clubMember.role, ["OWNER", "STAFF"]),
      ),
    );
  // A user can hold several rows in one club (e.g. STAFF + COACH); OWNER wins.
  return rows.find((r) => r.role === "OWNER") ?? rows[0] ?? null;
});

/** The signed-in user's access to a club, or a 404. Optionally require a permission. */
export async function requireClubAccess(slug: string, permission?: ClubPermission): Promise<ClubAccess> {
  const user = await requireOnboardedUser();
  if (slug.length > 64 || !clubSlugPattern.test(slug)) notFound();
  const row = await loadAccess(user.id, slug);
  if (!row) notFound();

  const role = row.role === "OWNER" ? "OWNER" : "STAFF";
  const access: ClubAccess = {
    user,
    club: {
      id: row.id,
      slug: row.slug,
      name: row.name,
      status: row.status,
      timezone: row.timezone,
      currency: row.currency,
      country: row.country,
      city: row.city,
    },
    role,
    memberId: row.memberId,
    permissions: role === "OWNER" ? allClubPermissions : row.permissions,
    readOnly: row.status === "SUSPENDED",
  };
  if (permission && !hasPermission(access, permission)) notFound();
  return access;
}

/** For pages: the section must be open to this member. */
export async function requireClubSection(slug: string, section: ClubSection): Promise<ClubAccess> {
  const access = await requireClubAccess(slug);
  if (!canOpenSection(access, section)) notFound();
  return access;
}

export const can = (access: ClubAccess, permission: ClubPermission) => hasPermission(access, permission);

/** Clubs the user can manage, for the club picker and the post-sign-in redirect. */
export async function listManagedClubs(userId: string) {
  return db
    .selectDistinctOn([club.id], { id: club.id, slug: club.slug, name: club.name, status: club.status, city: club.city })
    .from(club)
    .innerJoin(clubMember, eq(clubMember.clubId, club.id))
    .where(
      and(
        isNull(club.deletedAt),
        ne(club.status, "ARCHIVED"),
        eq(clubMember.userId, userId),
        eq(clubMember.status, "ACTIVE"),
        inArray(clubMember.role, ["OWNER", "STAFF"]),
      ),
    )
    .orderBy(club.id);
}
