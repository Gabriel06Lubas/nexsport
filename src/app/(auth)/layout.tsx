import type { ReactNode } from "react";

import { Logo } from "@/components/marketing/logo";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_40%_at_50%_0%,color-mix(in_oklab,var(--lime)_25%,transparent),transparent)]"
      />
      <header className="relative px-4 py-5 sm:px-6">
        <Logo />
      </header>
      <main id="main" className="relative flex flex-1 items-start justify-center px-4 pb-16 pt-6 sm:items-center sm:pt-0">
        {children}
      </main>
    </div>
  );
}
