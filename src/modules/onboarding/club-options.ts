import { currencies } from "@/modules/clubs/lib/forms";

// Select options for the club details form (built on the server).

const countries = ["ES", "PT", "FR", "IT", "DE", "NL", "BE", "GB", "IE", "CH", "AT", "SE", "NO", "DK", "FI", "PL", "US", "CA", "MX", "AR", "BR", "CL", "AU", "NZ", "AE", "ZA"];
const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

export const countryOptions = countries.map((code) => ({ value: code, label: regionNames.of(code) ?? code })).sort((a, b) => a.label.localeCompare(b.label));
export const timeZoneOptions = () => Intl.supportedValuesOf("timeZone").map((tz) => ({ value: tz, label: tz.replaceAll("_", " ") }));
export const currencyOptions = currencies.map((c) => ({ value: c, label: c.toUpperCase() }));
