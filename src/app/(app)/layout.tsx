import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Logo } from "@/components/marketing/logo";
import { ImpersonationBanner } from "@/modules/admin/components/impersonation-banner";
import { UserMenu } from "@/modules/auth/components/user-menu";
import { getCurrentUser } from "@/modules/auth/dal";

export const metadata: Metadata = { robots: { index: false } };

// The layout only *reads* the user for the header. It is not an auth check:
// layouts don't re-run on client navigation, so each page enforces access
// itself through the DAL (requireUser / requireArea).
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();

  return (
    <div className="min-h-dvh">
      <ImpersonationBanner user={user} />
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Logo />
          {user && <UserMenu user={user} />}
        </div>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        {children}
      </main>
    </div>
  );
}
