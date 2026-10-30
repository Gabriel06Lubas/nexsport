import { ArrowLeftRight, Plus, TriangleAlert } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { SectionNav } from "@/components/dashboard/section-nav";
import { listManagedClubs, requireClubAccess } from "@/modules/clubs/dal";
import { canOpenSection, clubSections } from "@/modules/clubs/lib/permissions";

// Tenant-scoped shell for /dashboard/[clubSlug]/*. The access check here is
// what keeps a non-member from seeing even the sidebar (a 404 thrown by a page
// renders inside its layout). Every page and every action checks again on
// its own: layouts aren't re-rendered on client navigation between pages.
export default async function ClubLayout({ children, params }: { children: ReactNode; params: Promise<{ clubSlug: string }> }) {
  const { clubSlug } = await params;
  const access = await requireClubAccess(clubSlug);
  const clubs = await listManagedClubs(access.user.id);
  const items = clubSections.filter((s) => canOpenSection(access, s.key)).map(({ key, path, label }) => ({ path, label, icon: key }));
  const { club } = access;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Club dashboard</p>
          <p className="truncate text-lg font-semibold">{club.name}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {club.status === "PENDING_SETUP" && <Badge variant="warning">Setting up</Badge>}
          {club.status === "SUSPENDED" && <Badge variant="danger">Suspended</Badge>}
          <Badge variant="outline">{access.role === "OWNER" ? "Owner" : "Staff"}</Badge>
          {clubs.length > 1 && (
            <Link href="/dashboard/club" className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-medium hover:bg-muted">
              <ArrowLeftRight className="size-3.5" aria-hidden /> Switch club
            </Link>
          )}
          {access.user.role === "CLUB_OWNER" && (
            <Link href={"/dashboard/club?new=1" as Route} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-medium hover:bg-muted">
              <Plus className="size-3.5" aria-hidden /> New club
            </Link>
          )}
        </div>
      </div>

      {access.readOnly && (
        <div role="alert" className="flex items-start gap-3 rounded-2xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
          <p>
            <span className="font-semibold">This club is suspended by nexport.</span> You can still see everything, but nothing can be changed
            until it&apos;s reactivated. Contact support to resolve it.
          </p>
        </div>
      )}
      {club.status === "PENDING_SETUP" && access.role === "OWNER" && (
        <div className="rounded-2xl border border-border bg-card px-4 py-3 text-sm">
          <span className="font-semibold">Finish setting up:</span> add your courts and prices, then{" "}
          <Link href={`/dashboard/${club.slug}/billing` as Route} className="font-medium text-accent-text hover:underline">
            connect Stripe
          </Link>{" "}
          to take online payments.
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-10">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <SectionNav label="Club" base={`/dashboard/${club.slug}`} items={items} />
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
