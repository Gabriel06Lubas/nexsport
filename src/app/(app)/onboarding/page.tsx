import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { OnboardingForm } from "@/modules/auth/components/onboarding-form";
import { requireUser } from "@/modules/auth/dal";
import { homePathFor } from "@/modules/auth/lib/roles";

export const metadata: Metadata = { title: "Welcome" };

export default async function OnboardingPage() {
  const user = await requireUser();
  if (user.onboarded || user.role === "ADMIN") redirect(homePathFor(user.role));

  return (
    <div className="mx-auto max-w-2xl">
      <p className="text-sm font-semibold uppercase tracking-wider text-accent-text">Welcome</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Let’s set up your account</h1>
      <p className="mt-2 text-muted-foreground">This takes ten seconds. Your handle is how teammates and clubs find you.</p>
      <div className="mt-8 rounded-3xl border border-border bg-card p-6 sm:p-8">
        <OnboardingForm defaultName={user.name ?? ""} />
      </div>
    </div>
  );
}
