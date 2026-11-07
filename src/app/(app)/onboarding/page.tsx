import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { db } from "@/db";
import { planCheckout, profile } from "@/db/schema";
import { requireUser } from "@/modules/auth/dal";
import { homePathFor } from "@/modules/auth/lib/roles";
import { RoleStep } from "@/modules/onboarding/components/role-step";
import { countryFromAcceptLanguage, phoneCountryOptions, splitPhone } from "@/modules/profile/lib/personal";

export const metadata: Metadata = { title: "Welcome" };

// Step 1 of 3: who you are. Club owners go on to choose and pay for a plan;
// their account stays a plain, un-onboarded one until the payment is confirmed.
export default async function OnboardingPage() {
  const user = await requireUser();
  if (user.onboarded || user.role === "ADMIN") redirect(homePathFor(user.role));
  const [[own], [openClub]] = await Promise.all([
    db.select({ handle: profile.handle, firstName: profile.firstName, lastName: profile.lastName, phone: profile.phone }).from(profile).where(eq(profile.userId, user.id)),
    db.select({ clubName: planCheckout.clubName }).from(planCheckout).where(and(eq(planCheckout.userId, user.id), eq(planCheckout.kind, "CLUB_SIGNUP"), eq(planCheckout.status, "OPEN"))).limit(1),
  ]);

  // Pre-fill from the profile (a club owner coming back) or the name Google/Apple gave us.
  const [given, ...family] = (user.name ?? "").trim().split(/\s+/);
  const phone = splitPhone(own?.phone);
  const defaults = {
    firstName: own?.firstName ?? given ?? "",
    lastName: own?.lastName ?? family.join(" "),
    handle: own?.handle,
    phoneCountry: phone.country ?? countryFromAcceptLanguage((await headers()).get("accept-language")),
    phone: phone.national,
  };

  return (
    <div className="mx-auto max-w-2xl">
      <p className="text-sm font-semibold uppercase tracking-wider text-accent-text">Step 1 of 3 · Welcome</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Let’s set up your account</h1>
      <p className="mt-2 text-muted-foreground">Tell us who you are. Your username is public; your phone number is only shared with the clubs and coaches you book with.</p>
      {own && (
        <p className="mt-6 rounded-2xl border border-border bg-card px-4 py-3 text-sm">
          {openClub?.clubName ? `You started setting up ${openClub.clubName}. ` : "You started setting up a club. "}
          <Link href="/onboarding/plan?for=club" className="font-medium text-accent-text hover:underline">
            Continue to the plan
          </Link>
          , or choose another option below.
        </p>
      )}
      <div className="mt-8 rounded-3xl border border-border bg-card p-6 sm:p-8">
        <RoleStep defaults={defaults} defaultRole={own ? "CLUB_OWNER" : undefined} phoneCountries={phoneCountryOptions()} />
      </div>
    </div>
  );
}
