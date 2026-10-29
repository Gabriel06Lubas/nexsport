import Link from "next/link";

import { cn } from "@/lib/utils";

export function Logo({ className }: { className?: string }) {
  return (
    <Link href="/" className={cn("flex items-center gap-2 font-semibold tracking-tight", className)} aria-label="nexport home">
      <svg viewBox="0 0 32 32" className="size-7" aria-hidden>
        <rect width="32" height="32" rx="9" className="fill-ink" />
        <path d="M9 23V9h3.2l7.6 9.3V9H23v14h-3.2L12.2 13.7V23z" className="fill-lime" />
      </svg>
      <span className="text-lg">nexport</span>
    </Link>
  );
}
