"use client";

import { Building2, CalendarDays, CreditCard, IdCard, LayoutDashboard, Menu, Users, X } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { cn } from "@/lib/utils";

import type { ClubSection } from "../lib/permissions";

const icons: Record<ClubSection, typeof LayoutDashboard> = {
  overview: LayoutDashboard,
  facilities: Building2,
  staff: Users,
  memberships: IdCard,
  schedule: CalendarDays,
  billing: CreditCard,
};

export type NavItem = { key: ClubSection; path: string; label: string };

function NavLinks({ base, items, onNavigate }: { base: string; items: NavItem[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <ul className="space-y-1">
      {items.map((item) => {
        const href = `${base}${item.path}`;
        const active = item.path === "" ? pathname === base : pathname === href || pathname.startsWith(`${href}/`);
        const Icon = icons[item.key];
        return (
          <li key={item.key}>
            <Link
              href={href as Route}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
                active ? "bg-ink text-ink-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Sidebar on large screens; a collapsible menu on small ones. Only sections the member can open are listed. */
export function ClubNav({ slug, items }: { slug: string; items: NavItem[] }) {
  const [open, setOpen] = useState(false);
  const base = `/dashboard/${slug}`;
  return (
    <>
      <nav aria-label="Club" className="hidden lg:block">
        <NavLinks base={base} items={items} />
      </nav>
      <div className="lg:hidden">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="club-mobile-nav"
          className="flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm font-medium"
        >
          {open ? <X className="size-4" aria-hidden /> : <Menu className="size-4" aria-hidden />} Menu
        </button>
        {open && (
          <nav id="club-mobile-nav" aria-label="Club" className="mt-3 rounded-2xl border border-border bg-card p-2">
            <NavLinks base={base} items={items} onNavigate={() => setOpen(false)} />
          </nav>
        )}
      </div>
    </>
  );
}
