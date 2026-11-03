"use client";

import { Check } from "lucide-react";
import { ActionForm, Field, FieldError, FormFooter, SelectField, useActionFormState } from "@/components/forms/action-form";
import { Badge } from "@/components/ui/badge";
import type { PricingCard } from "@/config/pricing";
import { cn } from "@/lib/utils";

import { startClubCheckout } from "../actions";

type Option = { value: string; label: string };

/**
 * Step 2 for club owners: pick Club Basic or Club Enterprise and describe the
 * club. Submitting records the purchase and opens Stripe Checkout; the club
 * itself is only created after Stripe confirms the payment.
 */
export function ClubCheckoutForm({
  plans,
  priceLabels,
  countries,
  timeZones,
  currencies,
}: {
  plans: PricingCard[];
  priceLabels: Record<string, string>;
  countries: Option[];
  timeZones: Option[];
  currencies: Option[];
}) {
  return (
    <ActionForm action={startClubCheckout} label="Club plan and details" className="space-y-8">
      <PlanChoice plans={plans} priceLabels={priceLabels} />

      <fieldset className="space-y-4">
        <legend className="text-sm font-medium">Your club</legend>
        <Field name="name" label="Club name" placeholder="Padel Central" maxLength={80} />
        <Field name="slug" label="Dashboard address" placeholder="padel-central" maxLength={48} hint="Lowercase letters, numbers and hyphens: /dashboard/padel-central" spellCheck={false} autoComplete="off" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field name="city" label="City" maxLength={80} hint="Optional" />
          <SelectField name="country" label="Country" options={countries} defaultValue="ES" />
          <SelectField name="timezone" label="Time zone" options={timeZones} defaultValue="Europe/Madrid" hint="Opening hours and prices use this zone" />
          <SelectField name="currency" label="Currency for bookings" options={currencies} defaultValue="eur" />
        </div>
      </fieldset>

      <div className="space-y-2">
        <FormFooter submit="Continue to payment" pendingLabel="Opening Stripe…" />
        <p className="text-xs text-muted-foreground">
          You&apos;ll pay securely with Stripe. Your club and owner access are set up as soon as the payment goes through; nothing is created if you don&apos;t complete it.
        </p>
      </div>
    </ActionForm>
  );
}

/** Plan radio cards; keeps the choice after a failed submit. */
function PlanChoice({ plans, priceLabels }: { plans: PricingCard[]; priceLabels: Record<string, string> }) {
  const state = useActionFormState();
  const tier = state.ok ? undefined : state.values?.tier;
  const chosen = plans.some((p) => p.id === tier) ? tier : undefined;
  return (
    // Remounted after each submit so defaultChecked reflects the last choice.
    <fieldset key={chosen ?? "default"}>
      <legend className="text-sm font-medium">Plan</legend>
      <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
        {plans.map((p, i) => (
          <label
            key={p.id}
            className={cn(
              "flex cursor-pointer flex-col rounded-2xl border border-border bg-card p-5 transition-colors hover:bg-muted/50",
              "has-[:checked]:border-ink has-[:checked]:ring-1 has-[:checked]:ring-ink has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring",
            )}
          >
            <input type="radio" name="tier" value={p.id} defaultChecked={chosen ? chosen === p.id : i === 0} className="sr-only" />
            <span className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold">{p.name}</span>
              {p.badge && <Badge variant="lime">{p.badge}</Badge>}
            </span>
            <span className="mt-2 text-2xl font-semibold tabular-nums">
              {priceLabels[p.id]}
              <span className="text-sm font-normal text-muted-foreground">/mo</span>
            </span>
            {p.includesPrevious && <span className="mt-3 text-xs font-medium">{p.includesPrevious}</span>}
            <ul className="mt-2 space-y-1.5">
              {p.features.map((f) => (
                <li key={f} className="flex gap-2 text-xs">
                  <Check className="mt-0.5 size-3.5 shrink-0 text-accent-text" aria-hidden /> {f}
                </li>
              ))}
            </ul>
          </label>
        ))}
      </div>
      <FieldError name="tier" />
    </fieldset>
  );
}
