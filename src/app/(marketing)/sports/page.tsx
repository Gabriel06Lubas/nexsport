import type { Metadata } from "next";

import { CtaBand } from "@/components/marketing/cta-band";
import { PageHero } from "@/components/marketing/section";
import { sports } from "@/config/sports";

export const metadata: Metadata = {
  title: "Sports",
  description: "nexport works for football, padel, tennis, fitness, basketball and multi-sport clubs.",
};

export default function SportsPage() {
  return (
    <>
      <PageHero
        eyebrow="Sports"
        title="One platform, every sport you run."
        description="Facilities, kit and age groups work the same way across sports, so a multi-sport club runs from a single account."
      />
      <div className="mx-auto grid max-w-7xl gap-4 px-4 py-16 sm:px-6 md:grid-cols-2 lg:grid-cols-3">
        {sports.map((s) => (
          <article key={s.slug} id={s.slug} className="scroll-mt-24 rounded-2xl border border-border bg-card p-6">
            <span aria-hidden className="text-4xl">
              {s.emoji}
            </span>
            <h2 className="mt-4 text-xl font-semibold">{s.name}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{s.pitch}</p>
            <dl className="mt-5 space-y-3 border-t border-border pt-5 text-sm">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Facilities</dt>
                <dd className="mt-1">{s.facilities.join(" · ")}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Equipment</dt>
                <dd className="mt-1">{s.kit.join(" · ")}</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
      <CtaBand title="Don’t see your sport?" description="If it has a venue, a coach and a schedule, nexport can run it. Tell us about your club." />
    </>
  );
}
