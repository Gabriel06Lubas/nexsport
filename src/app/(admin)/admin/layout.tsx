import { ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Logo } from "@/components/marketing/logo";
import { AdminNav } from "@/modules/admin/components/admin-nav";
import { UserMenu } from "@/modules/auth/components/user-menu";
import { requireAdmin } from "@/modules/auth/dal";

export const metadata: Metadata = { title: { default: "Admin", template: "%s · Admin · nexport" }, robots: { index: false } };

// Checked here as well as in every page: a 404 thrown by a page renders inside
// this layout, so without this check a non-admin would see the admin sidebar.
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const admin = await requireAdmin();

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Logo />
            <span className="inline-flex items-center gap-1 rounded-full bg-ink px-2.5 py-0.5 text-xs font-semibold text-ink-foreground">
              <ShieldCheck className="size-3.5" aria-hidden /> Admin
            </span>
          </div>
          <UserMenu user={admin} />
        </div>
      </header>
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-10 lg:py-10">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <AdminNav />
        </aside>
        <main id="main" className="min-w-0">
          {children}
        </main>
      </div>
    </div>
  );
}
