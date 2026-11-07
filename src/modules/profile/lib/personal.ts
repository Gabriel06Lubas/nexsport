import { getCountries, getCountryCallingCode, parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";
import { z } from "zod";

import { plainText } from "@/lib/validation";

// Personal details asked for at onboarding and editable in Settings:
// first and last name, a username (the public @handle) and a phone number.
// Names follow the plain-text rules in src/lib/validation.ts (no control,
// bidi or invisible characters) and must contain a letter. Phone numbers are
// checked against the country's real numbering plan (libphonenumber "max"
// metadata) and stored in E.164, the only form the database accepts
// (Profile_phone_e164).

const personName = (label: string) =>
  plainText({ min: 1, max: 50, label }).refine((value) => /\p{L}/u.test(value), `The ${label} needs at least one letter`);

export const handleSchema = z
  .string({ error: "Choose a username" })
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_.]{3,30}$/, "3–30 characters: letters, numbers, dots and underscores");

const countries = new Set<string>(getCountries());

/** "+34 612 34 56 78", "612345678" with country ES, … → "+34612345678", or null if it isn't a real number. */
export function toE164(raw: string, country: string): string | null {
  const input = raw.trim();
  if (input.length === 0 || input.length > 32 || !/^[+]?[0-9 ()./-]+$/.test(input)) return null;
  const parsed = parsePhoneNumberFromString(input, countries.has(country) ? (country as CountryCode) : undefined);
  return parsed?.isValid() ? parsed.number : null;
}

export const personalDetailsSchema = z
  .object({
    firstName: personName("first name"),
    lastName: personName("last name"),
    handle: handleSchema,
    phoneCountry: z.string().max(2).default(""),
    phone: z.string({ error: "Enter your phone number" }).max(64),
  })
  .transform((v, ctx) => {
    if (!v.phone.trim()) {
      ctx.addIssue({ code: "custom", path: ["phone"], message: "Enter your phone number" });
      return z.NEVER;
    }
    const phone = toE164(v.phone, v.phoneCountry);
    if (!phone) {
      ctx.addIssue({ code: "custom", path: ["phone"], message: "That isn't a valid phone number for the selected country" });
      return z.NEVER;
    }
    return { firstName: v.firstName, lastName: v.lastName, handle: v.handle, phone, displayName: `${v.firstName} ${v.lastName}`.slice(0, 60) };
  });

export type PersonalDetails = z.output<typeof personalDetailsSchema>;

/** Phone country picker: "Spain (+34)", sorted by name. */
export function phoneCountryOptions(locale = "en") {
  const names = new Intl.DisplayNames([locale], { type: "region" });
  return getCountries()
    .map((code) => ({ value: code, label: `${names.of(code) ?? code} (+${getCountryCallingCode(code)})` }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** The region of an Accept-Language header ("es-ES,es;q=0.9" → "ES"), if it's a phone country. */
export function countryFromAcceptLanguage(header: string | null, fallback = "ES"): string {
  for (const part of (header ?? "").split(",")) {
    const region = part.split(";")[0]?.trim().split("-")[1]?.toUpperCase();
    if (region && countries.has(region)) return region;
  }
  return fallback;
}

/** "+34612345678" → "+34 612 34 56 78" for display. */
export function formatPhone(e164: string | null | undefined): string | null {
  if (!e164) return null;
  return parsePhoneNumberFromString(e164)?.formatInternational() ?? e164;
}

/** "+34612345678" → { country: "ES", national: "612 34 56 78" } for pre-filling the form. */
export function splitPhone(e164: string | null | undefined): { country?: string; national?: string } {
  if (!e164) return {};
  const parsed = parsePhoneNumberFromString(e164);
  return parsed ? { country: parsed.country, national: parsed.formatNational() } : {};
}
