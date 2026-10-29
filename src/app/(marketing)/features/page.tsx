import type { Metadata } from "next";

import { CtaBand } from "@/components/marketing/cta-band";
import { PageHero } from "@/components/marketing/section";
import { Badge } from "@/components/ui/badge";
import { featureGroups } from "@/config/features";

export const metadata: Metadata = {
  title: "All features",
  description: "Every nexport capability: clubs, facilities, equipment, scheduling, attendance, payments, social, messaging, notifications and analytics.",
};

export default function FeaturesPage() {
  const total = featureGroups.reduce((n, g) => n + g.capabilities.length, 0);

  return (
    <>
      <PageHero
        eyebrow="Features"
        title="Everything nexport does."
        description={`${total} capabilities across ${featureGroups.length} modules, for clubs, coaches and athletes.`}
      />

      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[220px_1fr]">
        <nav aria-label="Feature groups" className="hidden lg:block">
          <ul className="sticky top-24 space-y-1">
            {featureGroups.map((g) => (
              <li key={g.id}>
                <a href={`#${g.id}`} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
                  <g.icon className="size-4" aria-hidden /> {g.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="space-y-16">
          {featureGroups.map((g) => (
            <section key={g.id} id={g.id} className="scroll-mt-24" aria-labelledby={`${g.id}-title`}>
              <div className="flex flex-wrap items-center gap-3">
                <span className="grid size-10 place-items-center rounded-xl bg-lime text-lime-foreground">
                  <g.icon className="size-5" aria-hidden />
                </span>
                <h2 id={`${g.id}-title`} className="text-2xl font-semibold tracking-tight">
                  {g.title}
                </h2>
                <div className="flex gap-1.5">
                  {g.audience.map((a) => (
                    <Badge key={a} variant="outline">
                      {a}
                    </Badge>
                  ))}
                </div>
              </div>
              <p className="mt-3 max-w-2xl text-muted-foreground">{g.summary}</p>
              <dl className="mt-6 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2">
                {g.capabilities.map((c) => (
                  <div key={c.title} className="bg-card p-5">
                    <dt className="font-semibold">{c.title}</dt>
                    <dd className="mt-1 text-sm text-muted-foreground">{c.detail}</dd>
                  </div>
                ))}
                {g.capabilities.length % 2 === 1 && <div aria-hidden className="hidden bg-card sm:block" />}
              </dl>
            </section>
          ))}
        </div>
      </div>

      <CtaBand />
    </>
  );
}
