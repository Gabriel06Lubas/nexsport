import { ArrowRight } from "lucide-react";

import { ButtonLink } from "@/components/ui/button";

export function CtaBand({
  title = "Bring your whole club onto one platform.",
  description = "Set up facilities, invite your coaches and open bookings in an afternoon.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <section className="px-4 pb-20 sm:px-6 sm:pb-28">
      <div className="mx-auto max-w-7xl overflow-hidden rounded-3xl bg-ink px-6 py-14 text-ink-foreground sm:px-12 sm:py-20">
        <div className="grid grid-cols-1 items-end gap-8 md:grid-cols-[1fr_auto]">
          <div>
            <h2 className="max-w-2xl text-3xl font-semibold tracking-tight text-balance sm:text-5xl">{title}</h2>
            <p className="mt-4 max-w-xl text-lg opacity-75">{description}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <ButtonLink href="/login" variant="accent" size="lg">
              Get started <ArrowRight />
            </ButtonLink>
            <ButtonLink href="/contact" size="lg" className="border border-current/25 bg-transparent text-ink-foreground hover:bg-ink-foreground/10">
              Book a demo
            </ButtonLink>
          </div>
        </div>
      </div>
    </section>
  );
}
