import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Window chrome around a product preview. Previews always use sample data. */
export function AppFrame({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <figure className={cn("min-w-0 overflow-hidden rounded-2xl border border-border bg-card shadow-[0_24px_60px_-30px_rgb(11_18_32/0.35)]", className)}>
      <div className="flex items-center gap-2 border-b border-border bg-muted/60 px-4 py-2.5">
        <span aria-hidden className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-border" />
          <span className="size-2.5 rounded-full bg-border" />
          <span className="size-2.5 rounded-full bg-border" />
        </span>
        <figcaption className="ml-2 min-w-0 truncate text-xs font-medium text-muted-foreground">{title}</figcaption>
        <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">Sample data</span>
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </figure>
  );
}
