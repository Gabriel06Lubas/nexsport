import type { Metadata } from "next";
import type { ReactNode } from "react";

import { BottomNav, type NavItem } from "@/components/dashboard/section-nav";
import { SectionNav } from "@/components/dashboard/section-nav";
import { requireStudent } from "@/modules/student/dal";

export const metadata: Metadata = { title: { default: "My sport", template: "%s · nexport" } };

const items: NavItem[] = [
  { path: "", label: "Overview & Upcoming", short: "Home", icon: "home" },
  { path: "/bookings", label: "Bookings & Passes", short: "Bookings", icon: "bookings" },
  { path: "/open-matches", label: "Open Match Finder", short: "Matches", icon: "matches" },
  { path: "/settings", label: "Account & Payments", short: "Account", icon: "settings" },
];

// Student-only shell, mobile first: a tab bar at the bottom on phones, a
// sidebar on large screens. The proxy has already sent signed-out visitors
// to /login; the role is checked here and again in every page and action
// (sessions live in the database, which the proxy doesn't query).
export default async function StudentLayout({ children }: { children: ReactNode }) {
  const student = await requireStudent();
  return (
    <div className="pb-20 lg:pb-0">
      <div className="mb-6 lg:hidden">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">My sport</p>
        <p className="truncate text-lg font-semibold">{student.name ?? student.email}</p>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-10">
        <aside className="hidden lg:sticky lg:top-24 lg:block lg:self-start">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">My sport</p>
          <p className="mb-4 truncate text-lg font-semibold">{student.name ?? student.email}</p>
          <SectionNav label="Student" base="/dashboard/student" items={items} />
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
      <BottomNav label="Student" base="/dashboard/student" items={items} />
    </div>
  );
}
