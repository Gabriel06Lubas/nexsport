"use client";

import { useActionState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { updatePlan, type ActionState } from "../actions";
import { bpsToInput, centsToInput } from "../lib/plan-form";

export type PlanView = {
  tier: string;
  name: string;
  audience: "COACH" | "CLUB";
  monthlyPriceAmount: number;
  currency: string;
  platformFeeBps: number;
  stripePriceId: string | null;
  maxFacilities: number | null;
  maxStaff: number | null;
  maxAthletes: number | null;
  isActive: boolean;
  updatedAt: string;
  liveSubscriptions: number;
};

const field = "mt-1 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm aria-[invalid=true]:border-danger";

function Field({
  name,
  label,
  hint,
  error,
  ...input
}: { name: string; label: string; hint?: string; error?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block text-sm">
      <span className="font-medium">{label}</span>
      <input name={name} aria-invalid={Boolean(error)} aria-describedby={`${name}-hint`} className={field} {...input} />
      <span id={`${name}-hint`} className={cn("mt-1 block text-xs", error ? "text-danger" : "text-muted-foreground")}>
        {error ?? hint}
      </span>
    </label>
  );
}

const limit = (value: number | null) => (value === null ? "" : String(value));

export function PlanEditor({ plan }: { plan: PlanView }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updatePlan, {});
  const errors = state.fieldErrors ?? {};

  return (
    <form action={action} className="rounded-2xl border border-border bg-card" noValidate aria-label={`${plan.name} plan`}>
      <input type="hidden" name="tier" value={plan.tier} />
      <input type="hidden" name="expectedUpdatedAt" value={plan.updatedAt} />
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <p className="font-mono text-xs text-muted-foreground">{plan.tier}</p>
          <p className="text-lg font-semibold">{plan.name}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{plan.audience === "COACH" ? "For coaches" : "For clubs"}</Badge>
          <Badge variant={plan.isActive ? "success" : "warning"}>{plan.isActive ? "Active" : "Inactive"}</Badge>
          <Badge variant="neutral">
            {plan.liveSubscriptions} {plan.liveSubscriptions === 1 ? "subscriber" : "subscribers"}
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
        <Field name="name" label="Display name" defaultValue={plan.name} maxLength={40} error={errors.name} />
        <Field
          name="monthlyPrice"
          label={`Monthly price (${plan.currency.toUpperCase()})`}
          defaultValue={centsToInput(plan.monthlyPriceAmount)}
          inputMode="decimal"
          error={errors.monthlyPrice}
          hint="0 for a free plan"
        />
        <Field
          name="platformFee"
          label="Platform fee per paid booking (%)"
          defaultValue={bpsToInput(plan.platformFeeBps)}
          inputMode="decimal"
          error={errors.platformFee}
          hint="e.g. 3 for a 3% rake on court bookings"
        />
        <Field
          name="stripePriceId"
          label="Stripe Price ID"
          defaultValue={plan.stripePriceId ?? ""}
          placeholder="price_…"
          spellCheck={false}
          autoComplete="off"
          error={errors.stripePriceId}
          hint="Required to activate a paid plan"
        />
        <Field name="maxFacilities" label="Max facilities" defaultValue={limit(plan.maxFacilities)} inputMode="numeric" error={errors.maxFacilities} hint="Blank = unlimited" />
        <Field name="maxStaff" label="Max staff & coaches" defaultValue={limit(plan.maxStaff)} inputMode="numeric" error={errors.maxStaff} hint="Blank = unlimited" />
        <Field name="maxAthletes" label="Max athletes" defaultValue={limit(plan.maxAthletes)} inputMode="numeric" error={errors.maxAthletes} hint="Blank = unlimited" />
        <label className="flex items-center gap-3 self-center text-sm">
          <input type="checkbox" name="isActive" defaultChecked={plan.isActive} className="size-4 accent-[var(--chart-1)]" />
          <span>
            <span className="font-medium">Available for new sign-ups</span>
            <span className="block text-xs text-muted-foreground">Existing subscribers are never affected</span>
          </span>
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3">
        <p aria-live="polite" className="min-h-5 text-sm">
          {state.error ? <span className="text-danger">{state.error}</span> : state.ok ? <span className="text-success">{state.ok}</span> : null}
        </p>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
