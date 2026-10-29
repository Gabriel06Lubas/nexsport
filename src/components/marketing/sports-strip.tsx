import Link from "next/link";

import { sports } from "@/config/sports";

export function SportsStrip() {
  return (
    <div className="border-y border-border bg-card">
      <ul className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-8 gap-y-3 px-4 py-6 sm:px-6">
        {sports.map((s) => (
          <li key={s.slug}>
            <Link href={`/sports#${s.slug}`} className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground">
              <span aria-hidden className="text-lg">
                {s.emoji}
              </span>
              {s.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
