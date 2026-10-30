"use client";

import { Building2, CalendarClock, CalendarDays, CreditCard, IdCard, LayoutDashboard, Link2, Menu, Users, Wallet, X } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { cn } from "@/lib/utils";

// Sidebar on large screens, a collapsible menu on small ones. Shared by the
// club and coach dashboards. Icons are named (functions can't be passed from
// a server component to a client one).

const icons = {
  overview: LayoutDashboard,
  facilities: Building2,
  staff: Users,
  memberships: IdCard,
  schedule: CalendarDays,
  billing: CreditCard,
  sessions: CalendarClock,
  students: Users,
  availability: Link2,
  earnings: Wallet,
} as const;

export type NavIcon = keyof typeof icons;
export type NavItem = { path: string; label: string; icon: NavIcon };

function NavLinks({ base, items, onNavigate }: { base: string; items: NavItem[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <ul className="space-y-1">
      {items.map((item) => {
        const href = `${base}${item.path}`;
        const active = item.path === "" ? pathname === base : pathname === href || pathname.startsWith(`${href}/`);
        const Icon = icons[item.icon];
        return (
          <li key={item.path}>
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

export function SectionNav({ label, base, items }: { label: string; base: string; items: NavItem[] }) {
  const [open, setOpen] = useState(false);
  const id = `${label.toLowerCase()}-mobile-nav`;
  return (
    <>
      <nav aria-label={label} className="hidden lg:block">
        <NavLinks base={base} items={items} />
      </nav>
      <div className="lg:hidden">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={id}
          className="flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm font-medium"
        >
          {open ? <X className="size-4" aria-hidden /> : <Menu className="size-4" aria-hidden />} Menu
        </button>
        {open && (
          <nav id={id} aria-label={label} className="mt-3 rounded-2xl border border-border bg-card p-2">
            <NavLinks base={base} items={items} onNavigate={() => setOpen(false)} />
          </nav>
        )}
      </div>
    </>
  );
}
