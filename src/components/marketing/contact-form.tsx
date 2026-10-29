"use client";

import { Mail } from "lucide-react";
import { useId } from "react";

import { Button } from "@/components/ui/button";
import { siteConfig } from "@/config/site";

/** Builds a pre-filled email; there is no backend behind this form. */
export function ContactForm() {
  const id = useId();
  const field = "mt-1 w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm";

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const get = (k: string) => String(data.get(k) ?? "").trim();
    const subject = `Demo request: ${get("club") || get("name")}`;
    const body = [
      `Name: ${get("name")}`,
      `Club / business: ${get("club")}`,
      `I am a: ${get("role")}`,
      `Sports: ${get("sports")}`,
      "",
      get("message"),
    ].join("\n");
    window.location.href = `mailto:${siteConfig.contactEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4 rounded-2xl border border-border bg-card p-6 sm:grid-cols-2">
      <label className="text-sm" htmlFor={`${id}-name`}>
        <span className="text-muted-foreground">Your name</span>
        <input id={`${id}-name`} name="name" required autoComplete="name" className={field} />
      </label>
      <label className="text-sm" htmlFor={`${id}-club`}>
        <span className="text-muted-foreground">Club or business</span>
        <input id={`${id}-club`} name="club" autoComplete="organization" className={field} />
      </label>
      <label className="text-sm" htmlFor={`${id}-role`}>
        <span className="text-muted-foreground">I am a…</span>
        <select id={`${id}-role`} name="role" className={field} defaultValue="Club owner">
          <option>Club owner</option>
          <option>Club staff</option>
          <option>Coach</option>
          <option>Athlete</option>
          <option>Other</option>
        </select>
      </label>
      <label className="text-sm" htmlFor={`${id}-sports`}>
        <span className="text-muted-foreground">Sports</span>
        <input id={`${id}-sports`} name="sports" placeholder="e.g. Padel, tennis" className={field} />
      </label>
      <label className="text-sm sm:col-span-2" htmlFor={`${id}-message`}>
        <span className="text-muted-foreground">What would you like to see?</span>
        <textarea id={`${id}-message`} name="message" rows={4} className={field} />
      </label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Button type="submit">
          <Mail /> Send request
        </Button>
        <span className="text-xs text-muted-foreground">Opens your email app with the details filled in.</span>
      </div>
    </form>
  );
}
