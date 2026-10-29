import { ShieldCheck } from "lucide-react";
import Link from "next/link";

import type { CurrentUser } from "../dal";

/** Temporary dashboard body until each area's features land. */
export function AreaPlaceholder({ user, title, description }: { user: CurrentUser; title: string; description: string }) {
  return (
    <div>
      <p className="text-sm font-semibold uppercase tracking-wider text-accent-text">{title}</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Welcome, {user.name?.split(" ")[0] ?? "there"}</h1>
      <p className="mt-2 max-w-2xl text-muted-foreground">{description}</p>
      <div className="mt-8 rounded-2xl border border-dashed border-border p-8 text-sm text-muted-foreground">
        This area is protected for your role. Its features are built in the next steps.
      </div>
      <Link href="/dashboard/settings/security" className="mt-6 inline-flex items-center gap-2 text-sm font-medium hover:underline">
        <ShieldCheck className="size-4" aria-hidden /> Review your devices and connected accounts
      </Link>
    </div>
  );
}
