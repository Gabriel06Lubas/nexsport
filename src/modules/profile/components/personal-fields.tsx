"use client";

import { Field, SelectField } from "@/components/forms/action-form";

export type PersonalDefaults = { firstName?: string; lastName?: string; handle?: string; phoneCountry?: string; phone?: string };

/**
 * First and last name, username and phone number, for any ActionForm whose
 * action parses personalDetailsSchema (onboarding, Settings → Personal details).
 */
export function PersonalFields({ defaults, phoneCountries }: { defaults: PersonalDefaults; phoneCountries: { value: string; label: string }[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field name="firstName" label="First name" defaultValue={defaults.firstName} autoComplete="given-name" maxLength={50} />
      <Field name="lastName" label="Last name" defaultValue={defaults.lastName} autoComplete="family-name" maxLength={50} />
      <Field
        name="handle"
        label="Username"
        defaultValue={defaults.handle}
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        maxLength={30}
        hint="Your public @name. 3–30 characters: letters, numbers, dots and underscores"
        className="sm:col-span-2"
      />
      <SelectField name="phoneCountry" label="Phone country" options={phoneCountries} defaultValue={defaults.phoneCountry ?? "ES"} />
      <Field
        name="phone"
        label="Phone number"
        type="tel"
        defaultValue={defaults.phone}
        autoComplete="tel-national"
        inputMode="tel"
        maxLength={32}
        hint="Only shared with the clubs and coaches you book with"
      />
    </div>
  );
}
