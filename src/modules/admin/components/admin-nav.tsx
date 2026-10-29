"use client";

import { Activity, Building2, CreditCard, LayoutDashboard, Menu, ScrollText, X } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { cn } from "@/lib/utils";

const items: { href: Route; label: string; icon: typeof LayoutDashboard }[] = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/tenants", label: "Tenants & Clubs", icon: Building2 },
  { href: "/admin/subscriptions", label: "Subscription Tiers", icon: CreditCard },
  { href: "/admin/financials", label: "Financials & Connect", icon: Activity },
  { href: "/admin/logs", label: "Logs & Webhooks", icon: ScrollText },
];

function isActive(pathname: string, href: string) {
  return href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`);
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <ul className="space-y-1">
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
                active ? "bg-ink text-ink-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <item.icon className="size-4 shrink-0" aria-hidden />
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Sidebar on large screens; a collapsible menu under the top bar on small ones. */
export function AdminNav() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <nav aria-label="Admin" className="hidden lg:block">
        <NavLinks />
      </nav>
      <div className="lg:hidden">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="admin-mobile-nav"
          className="flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm font-medium"
        >
          {open ? <X className="size-4" aria-hidden /> : <Menu className="size-4" aria-hidden />} Menu
        </button>
        {open && (
          <nav id="admin-mobile-nav" aria-label="Admin" className="mt-3 rounded-2xl border border-border bg-card p-2">
            <NavLinks onNavigate={() => setOpen(false)} />
          </nav>
        )}
      </div>
    </>
  );
}
