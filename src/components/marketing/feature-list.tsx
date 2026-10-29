import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

export function FeatureList({ items, className }: { items: string[]; className?: string }) {
  return (
    <ul className={cn("grid gap-3 sm:grid-cols-2", className)}>
      {items.map((t) => (
        <li key={t} className="flex gap-2 text-sm">
          <Check className="mt-0.5 size-4 shrink-0 text-accent-text" aria-hidden /> {t}
        </li>
      ))}
    </ul>
  );
}
