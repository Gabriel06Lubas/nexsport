"use client";

import { Building2, ClipboardList, Trophy } from "lucide-react";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { completeOnboarding, type OnboardingState } from "../actions";

const roles = [
  { value: "STUDENT", label: "Athlete", description: "I train, play and join sessions", icon: Trophy },
  { value: "COACH", label: "Coach", description: "I run sessions and coach athletes", icon: ClipboardList },
  { value: "CLUB_OWNER", label: "Club owner", description: "I run a club, its facilities and staff", icon: Building2 },
] as const;

export function OnboardingForm({ defaultName }: { defaultName: string }) {
  const [state, action, pending] = useActionState<OnboardingState, FormData>(completeOnboarding, {});
  const v = state.values ?? {};
  const field = "mt-1 h-11 w-full rounded-xl border border-border bg-card px-3 text-sm aria-[invalid=true]:border-danger";

  return (
    <form action={action} className="space-y-6" noValidate>
      <fieldset>
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
              <input type="radio" name="role" value={r.value} defaultChecked={(v.role ?? "STUDENT") === r.value} className="sr-only" />
              <r.icon className="size-5 text-accent-text" aria-hidden />
              <span className="mt-1 font-semibold">{r.label}</span>
              <span className="text-xs text-muted-foreground">{r.description}</span>
            </label>
          ))}
        </div>
        {state.errors?.role && <p className="mt-1 text-sm text-danger">{state.errors.role}</p>}
        <p className="mt-2 text-xs text-muted-foreground">Staff accounts are created when a club invites you.</p>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm">
          <span className="font-medium">Display name</span>
          <input
            name="displayName"
            defaultValue={v.displayName ?? defaultName}
            autoComplete="name"
            maxLength={60}
            aria-invalid={Boolean(state.errors?.displayName)}
            aria-describedby="displayName-error"
            className={field}
          />
          <span id="displayName-error" className="mt-1 block text-sm text-danger">
            {state.errors?.displayName}
          </span>
        </label>
        <label className="text-sm">
          <span className="font-medium">Profile handle</span>
          <span className="relative block">
            <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 mt-0.5 -translate-y-1/2 text-muted-foreground">
              @
            </span>
            <input
              name="handle"
              defaultValue={v.handle}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={30}
              aria-invalid={Boolean(state.errors?.handle)}
              aria-describedby="handle-hint"
              className={cn(field, "pl-7")}
            />
          </span>
          <span id="handle-hint" className={cn("mt-1 block text-xs", state.errors?.handle ? "text-sm text-danger" : "text-muted-foreground")}>
            {state.errors?.handle ?? "3–30 characters: letters, numbers, dots and underscores"}
          </span>
        </label>
      </div>

      <Button type="submit" size="lg" disabled={pending} className="w-full sm:w-auto">
        {pending ? "Setting up…" : "Continue"}
      </Button>
    </form>
  );
}
