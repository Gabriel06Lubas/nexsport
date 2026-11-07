import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { headers } from "next/headers";

import { ActionForm, FormFooter } from "@/components/forms/action-form";
import { db } from "@/db";
import { profile } from "@/db/schema";
import { requireOnboardedUser } from "@/modules/auth/dal";
import { updatePersonalDetails } from "@/modules/profile/actions";
import { PersonalFields } from "@/modules/profile/components/personal-fields";
import { countryFromAcceptLanguage, phoneCountryOptions, splitPhone } from "@/modules/profile/lib/personal";

export const metadata: Metadata = { title: "Personal details" };

export default async function PersonalDetailsPage() {
  const user = await requireOnboardedUser();
  const [own] = await db
    .select({ handle: profile.handle, firstName: profile.firstName, lastName: profile.lastName, phone: profile.phone })
    .from(profile)
    .where(eq(profile.userId, user.id));
  // Accounts from before these fields existed: start from the account name.
  const [given, ...family] = (user.name ?? "").trim().split(/\s+/);
  const phone = splitPhone(own?.phone);
  const missing = !own?.firstName || !own.lastName || !own.phone;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Personal details</h1>
        <p className="mt-2 text-muted-foreground">
          Your name and username are shown to others on nexport. Your phone number is only visible to the clubs and coaches you train with.
        </p>
      </div>
      {missing && (
        <p role="status" className="rounded-2xl border border-border bg-card px-4 py-3 text-sm">
          Add your full name and phone number so clubs and coaches can reach you about your bookings.
        </p>
      )}
      <div className="rounded-3xl border border-border bg-card p-6 sm:p-8">
        <ActionForm action={updatePersonalDetails} label="Personal details" className="space-y-6">
          <PersonalFields
            defaults={{
              firstName: own?.firstName ?? given ?? "",
              lastName: own?.lastName ?? family.join(" "),
              handle: own?.handle,
              phoneCountry: phone.country ?? countryFromAcceptLanguage((await headers()).get("accept-language")),
              phone: phone.national,
            }}
            phoneCountries={phoneCountryOptions()}
          />
          <p className="text-xs text-muted-foreground">Email: {user.email} (your sign-in address; it can&apos;t be changed here).</p>
          <FormFooter submit="Save" />
        </ActionForm>
      </div>
    </div>
  );
}
