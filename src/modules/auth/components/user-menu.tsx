import { LogOut, ShieldCheck } from "lucide-react";
import Link from "next/link";

import { signOutAction } from "../actions";
import type { CurrentUser } from "../dal";

const roleLabels: Record<CurrentUser["role"], string> = {
  SUPER_ADMIN: "Admin",
  CLUB_OWNER: "Club owner",
  STAFF: "Staff",
  COACH: "Coach",
  STUDENT: "Athlete",
};

export function UserMenu({ user }: { user: CurrentUser }) {
  const initials = (user.name ?? user.email)
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");

  return (
    <details className="group relative">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-full p-1 pr-3 hover:bg-muted">
        {user.image ? (
          // eslint-disable-next-line @next/next/no-img-element -- provider avatars come from arbitrary hosts
          <img src={user.image} alt="" className="size-8 rounded-full object-cover" referrerPolicy="no-referrer" />
        ) : (
          <span aria-hidden className="grid size-8 place-items-center rounded-full bg-lime text-xs font-bold text-lime-foreground">
            {initials}
          </span>
        )}
        <span className="hidden text-sm font-medium sm:inline">{user.name ?? user.email}</span>
        <span className="sr-only">Open account menu</span>
      </summary>
      <div className="absolute right-0 z-50 mt-2 w-64 rounded-2xl border border-border bg-card p-2 shadow-lg">
        <div className="px-3 py-2">
          <p className="truncate text-sm font-medium">{user.name ?? "Your account"}</p>
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          {user.onboarded && <p className="mt-1 text-xs text-accent-text">{roleLabels[user.role]}</p>}
        </div>
        <Link href="/dashboard/settings/security" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-muted">
          <ShieldCheck className="size-4" aria-hidden /> Security & devices
        </Link>
        <form action={signOutAction}>
          <button type="submit" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted">
            <LogOut className="size-4" aria-hidden /> Sign out
          </button>
        </form>
      </div>
    </details>
  );
}
