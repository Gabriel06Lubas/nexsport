"use client";

import { Building2, ClipboardList, Trophy } from "lucide-react";

import { ActionForm, FieldError, FormFooter, useActionFormState } from "@/components/forms/action-form";
import { cn } from "@/lib/utils";
import { PersonalFields, type PersonalDefaults } from "@/modules/profile/components/personal-fields";

import { chooseRole } from "../actions";

const roles = [
  { value: "STUDENT", label: "Athlete", description: "I train, play and join sessions. Always free.", icon: Trophy },
  { value: "COACH", label: "Coach", description: "I run sessions and coach athletes. Free or Pro.", icon: ClipboardList },
  { value: "CLUB_OWNER", label: "Club owner", description: "I run a club or facility. Club Basic or Enterprise.", icon: Building2 },
] as const;

/** Step 1: how you'll use nexport, and who you are. */
export function RoleStep({ defaults, defaultRole, phoneCountries }: { defaults: PersonalDefaults; defaultRole?: string; phoneCountries: { value: string; label: string }[] }) {
  return (
    <ActionForm action={chooseRole} label="Set up your account" className="space-y-8">
      <RoleChoice defaultRole={defaultRole} />
      <fieldset className="space-y-4">
        <legend className="text-sm font-medium">About you</legend>
        <PersonalFields defaults={defaults} phoneCountries={phoneCountries} />
      </fieldset>
      <FormFooter submit="Continue" pendingLabel="Setting up…" />
    </ActionForm>
  );
}

function RoleChoice({ defaultRole }: { defaultRole?: string }) {
  const state = useActionFormState();
  const chosen = state.values?.role ?? defaultRole ?? "STUDENT";
  return (
    <fieldset key={chosen}>
      <legend className="text-sm font-medium">I’m joining as…</legend>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        {roles.map((r) => (
          <label
            key={r.value}
            className={cn(
              "flex cursor-pointer flex-col gap-1 rounded-2xl border border-border p-4 transition-colors hover:bg-muted",
              "has-[:checked]:border-ink has-[:checked]:ring-1 has-[:checked]:ring-ink has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring",
            )}
          >
            <input type="radio" name="role" value={r.value} defaultChecked={chosen === r.value} className="sr-only" />
            <r.icon className="size-5 text-accent-text" aria-hidden />
            <span className="mt-1 font-semibold">{r.label}</span>
            <span className="text-xs text-muted-foreground">{r.description}</span>
          </label>
        ))}
      </div>
      <FieldError name="role" />
      <p className="mt-2 text-xs text-muted-foreground">Staff accounts are created when a club invites you.</p>
    </fieldset>
  );
}
