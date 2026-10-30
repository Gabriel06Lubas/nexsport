import { ChevronRight } from "lucide-react";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ActionForm, Field, FormFooter, SelectField } from "@/components/forms/action-form";
import { Badge } from "@/components/ui/badge";
import { requireOnboardedUser } from "@/modules/auth/dal";
import { homePathFor } from "@/modules/auth/lib/roles";
import { createClub } from "@/modules/clubs/actions/club";
import { listManagedClubs } from "@/modules/clubs/dal";
import { currencies } from "@/modules/clubs/lib/forms";

export const metadata: Metadata = { title: "Your clubs" };

const countries = ["ES", "PT", "FR", "IT", "DE", "NL", "BE", "GB", "IE", "CH", "AT", "SE", "NO", "DK", "FI", "PL", "US", "CA", "MX", "AR", "BR", "CL", "AU", "NZ", "AE", "ZA"];
const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
const countryOptions = countries.map((code) => ({ value: code, label: regionNames.of(code) ?? code })).sort((a, b) => a.label.localeCompare(b.label));
const timeZoneOptions = Intl.supportedValuesOf("timeZone").map((tz) => ({ value: tz, label: tz.replaceAll("_", " ") }));
const currencyOptions = currencies.map((c) => ({ value: c, label: c.toUpperCase() }));

// Entry point of the club area: one club → straight to it; several → pick;
// none (or ?new=1) → club owners create one here.
export default async function ClubPickerPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireOnboardedUser();
  if (user.role === "ADMIN") redirect("/admin");
  const clubs = await listManagedClubs(user.id);
  // ?new=1: an owner adding a second club stays on this page.
  const adding = (await searchParams).new === "1" && user.role === "CLUB_OWNER";
  if (clubs.length === 1 && !adding) redirect(`/dashboard/${clubs[0]!.slug}` as Route);
  // STAFF's home is this page, so redirecting them would loop.
  if (clubs.length === 0 && user.role !== "CLUB_OWNER" && user.role !== "STAFF") redirect(homePathFor(user.role));

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <p className="text-sm font-semibold uppercase tracking-wider text-accent-text">Club dashboard</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{clubs.length || user.role !== "CLUB_OWNER" ? "Your clubs" : "Create your club"}</h1>
        <p className="mt-2 text-muted-foreground">
          {clubs.length
            ? "Pick the club you want to manage."
            : user.role === "CLUB_OWNER"
              ? "Set up your club, then add courts, prices, memberships and your team."
              : "You're not on any club's staff yet. Ask the club owner to add you with this account's email."}
        </p>
      </div>

      {clubs.length > 0 && (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
          {clubs.map((c) => (
            <li key={c.id}>
              <Link href={`/dashboard/${c.slug}` as Route} className="flex items-center gap-3 px-5 py-4 hover:bg-muted/60">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{c.name}</span>
                  <span className="block text-xs text-muted-foreground">{[c.city, `/${c.slug}`].filter(Boolean).join(" · ")}</span>
                </span>
                {c.status !== "ACTIVE" && <Badge variant={c.status === "SUSPENDED" ? "danger" : "warning"}>{c.status === "SUSPENDED" ? "Suspended" : "Setting up"}</Badge>}
                <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {user.role === "CLUB_OWNER" && (
        <section aria-labelledby="new-club" className="rounded-3xl border border-border bg-card p-6 sm:p-8">
          <h2 id="new-club" className="text-lg font-semibold">
            {clubs.length ? "Add another club" : "Club details"}
          </h2>
          <ActionForm action={createClub} label="Create a club" className="mt-4 space-y-4">
            <Field name="name" label="Club name" placeholder="Padel Central" maxLength={80} />
            <Field name="slug" label="Dashboard address" placeholder="padel-central" maxLength={48} hint="Lowercase letters, numbers and hyphens: /dashboard/padel-central" spellCheck={false} autoComplete="off" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field name="city" label="City" maxLength={80} hint="Optional" />
              <SelectField name="country" label="Country" options={countryOptions} defaultValue="ES" />
              <SelectField name="timezone" label="Time zone" options={timeZoneOptions} defaultValue="Europe/Madrid" hint="Opening hours and prices use this zone" />
              <SelectField name="currency" label="Currency" options={currencyOptions} defaultValue="eur" />
            </div>
            <FormFooter submit="Create club" pendingLabel="Creating…" />
          </ActionForm>
        </section>
      )}
    </div>
  );
}
