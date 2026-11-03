"use client";

import { Check } from "lucide-react";
import type { Route } from "next";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import type { PricingCard, Segment } from "@/config/pricing";
import { cn } from "@/lib/utils";

// Coaches / Clubs / Athletes as tabs (WAI-ARIA tabs pattern: arrow keys,
// Home/End). The URL hash selects a tab, so /pricing#clubs links straight
// to club plans.

function formatPrice(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase(), minimumFractionDigits: amount % 100 === 0 ? 0 : 2 }).format(amount / 100);
}

export function PricingTabs({
  segments,
  cards,
  currency,
}: {
  segments: { id: Segment; label: string; short: string; description: string }[];
  cards: PricingCard[];
  currency: string;
}) {
  const [active, setActive] = useState<Segment>("coaches");
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    const fromHash = () => {
      const hash = window.location.hash.slice(1);
      if (segments.some((s) => s.id === hash)) setActive(hash as Segment);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [segments]);

  const select = (id: Segment, focus = false) => {
    setActive(id);
    window.history.replaceState(null, "", `#${id}`);
    if (focus) tabs.current[segments.findIndex((s) => s.id === id)]?.focus();
  };
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const next = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? segments.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    select(segments[(next + segments.length) % segments.length]!.id, true);
  };

  const segment = segments.find((s) => s.id === active)!;
  const shown = cards.filter((c) => c.segment === active);

  return (
    <div>
      <div role="tablist" aria-label="Plans for" className="mx-auto flex w-fit max-w-full justify-center gap-1 rounded-full border border-border bg-card p-1">
        {segments.map((s, i) => (
          <button
            key={s.id}
            ref={(el) => {
              tabs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`tab-${s.id}`}
            aria-selected={active === s.id}
            aria-controls={`panel-${s.id}`}
            tabIndex={active === s.id ? 0 : -1}
            onClick={() => select(s.id)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn("rounded-full px-4 py-2 text-sm font-medium transition-colors", active === s.id ? "bg-ink text-ink-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            {/* Short labels keep the tabs on one line on phones. */}
            <span className="sm:hidden">{s.short}</span>
            <span className="hidden sm:inline">{s.label}</span>
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${active}`} aria-labelledby={`tab-${active}`} className="mt-8">
        <p className="text-center text-sm text-muted-foreground">{segment.description}</p>
        <div className={cn("mx-auto mt-8 grid grid-cols-1 gap-4", shown.length > 1 ? "max-w-4xl md:grid-cols-2" : "max-w-md")}>
          {shown.map((c) => (
            <section
              key={c.id}
              aria-label={`${c.name} plan`}
              className={cn("flex min-w-0 flex-col rounded-2xl border bg-card p-6", c.featured ? "border-ink ring-1 ring-ink" : "border-border")}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-lg font-semibold">{c.name}</h3>
                {c.badge && <Badge variant="lime">{c.badge}</Badge>}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{c.tagline}</p>
              <p className="mt-6">
                <span className="text-4xl font-semibold tabular-nums">{formatPrice(c.monthlyPriceAmount, currency)}</span>
                <span className="text-sm text-muted-foreground">/mo</span>
              </p>
              {c.includesPrevious && <p className="mt-6 text-sm font-medium">{c.includesPrevious}</p>}
              <ul className={cn("flex-1 space-y-2.5", c.includesPrevious ? "mt-3" : "mt-6")}>
                {c.features.map((f) => (
                  <li key={f} className="flex gap-2 text-sm">
                    <Check className="mt-0.5 size-4 shrink-0 text-accent-text" aria-hidden /> <span className="min-w-0">{f}</span>
                  </li>
                ))}
              </ul>
              <ButtonLink href={c.cta.href as Route} variant={c.featured ? "primary" : "outline"} className="mt-8">
                {c.cta.label}
              </ButtonLink>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
