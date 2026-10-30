import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { cn, formatMoney } from "@/lib/utils";

import { connectLabels, connectState, type ConnectState } from "@/lib/connect-status";
import { pageCount } from "@/lib/list-params";

// Small presentational pieces shared by the admin and club dashboards.
// Admin pages show UTC; club pages pass the club's time zone.

const formats = new Map<string, Intl.DateTimeFormat>();
function format(kind: "date" | "dateTime" | "time", timeZone: string) {
  const key = `${kind}:${timeZone}`;
  let f = formats.get(key);
  if (!f) {
    const style: Intl.DateTimeFormatOptions =
      kind === "date" ? { dateStyle: "medium" } : kind === "time" ? { timeStyle: "short" } : { dateStyle: "medium", timeStyle: "short" };
    f = new Intl.DateTimeFormat("en-GB", { ...style, timeZone });
    formats.set(key, f);
  }
  return f;
}

export const formatDate = (value: Date | string, timeZone = "UTC") => format("date", timeZone).format(new Date(value));
export const formatTime = (value: Date | string, timeZone: string) => format("time", timeZone).format(new Date(value));
export const formatDateTime = (value: Date | string, timeZone?: string) =>
  timeZone ? format("dateTime", timeZone).format(new Date(value)) : `${format("dateTime", "UTC").format(new Date(value))} UTC`;

/** "€1,234.00", or "€1,234.00 · $50.00" when several currencies are involved. */
export function moneyTotals(totals: { currency: string; amount: number }[], empty = "€0.00") {
  return totals.length ? totals.map((t) => formatMoney(t.amount, t.currency)).join(" · ") : empty;
}

export function PageHeader({ title, description, children }: { title: string; description?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </div>
  );
}

export function KpiCard({ label, value, hint, icon }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode }) {
  return (
    <section aria-label={label} className="min-w-0 rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{label}</span>
        {icon}
      </div>
      <p className="mt-3 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </section>
  );
}

export function Panel({ title, action, children, className }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("min-w-0 rounded-2xl border border-border bg-card", className)} aria-label={title}>
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="px-5 py-8 text-center text-sm text-muted-foreground">{children}</p>;
}

/** Horizontally scrollable table wrapper, so wide tables never widen the page. */
export function TableWrap({ children }: { children: ReactNode }) {
  // `relative`: absolutely positioned descendants (e.g. sr-only labels) are
  // contained, so they can't stick out of the scroll area and widen the page.
  return <div className="relative w-full max-w-full overflow-x-auto">{children}</div>;
}

export const th = "px-5 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground";
export const td = "px-5 py-3 text-sm align-middle";

const connectVariant: Record<ConnectState, "success" | "danger" | "warning" | "outline"> = {
  active: "success",
  restricted: "danger",
  onboarding: "warning",
  not_connected: "outline",
};

export function ConnectBadge(account: Parameters<typeof connectState>[0]) {
  const state = connectState(account);
  return <Badge variant={connectVariant[state]}>{connectLabels[state]}</Badge>;
}

const statusVariant: Record<string, "success" | "danger" | "warning" | "neutral" | "outline"> = {
  ACTIVE: "success",
  SUCCEEDED: "success",
  PAID: "success",
  WON: "success",
  SUSPENDED: "danger",
  FAILED: "danger",
  REVERSED: "danger",
  LOST: "danger",
  NEEDS_RESPONSE: "danger",
  WARNING_NEEDS_RESPONSE: "danger",
  PAST_DUE: "warning",
  PENDING: "warning",
  PENDING_SETUP: "warning",
  UNDER_REVIEW: "warning",
  WARNING_UNDER_REVIEW: "warning",
  PROCESSING: "warning",
  TRIALING: "neutral",
  ARCHIVED: "outline",
};

/** A status enum as a readable badge: "NEEDS_RESPONSE" → "Needs response". */
export function StatusBadge({ status }: { status: string }) {
  const text = status.charAt(0) + status.slice(1).toLowerCase().replaceAll("_", " ");
  return <Badge variant={statusVariant[status] ?? "neutral"}>{text}</Badge>;
}

export function TierBadge({ tier }: { tier: string | null }) {
  if (!tier) return <span className="text-sm text-muted-foreground">No plan</span>;
  const label = tier
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
  return <Badge variant={tier === "FREE_COACH" ? "outline" : "lime"}>{label}</Badge>;
}

/** Previous / next links that keep the other query parameters. */
export function Pagination({ basePath, params, page, total }: { basePath: string; params: Record<string, string>; page: number; total: number }) {
  const pages = pageCount(total);
  const href = (p: number) => `${basePath}?${new URLSearchParams({ ...params, page: String(p) })}` as Route;
  const link = "rounded-full border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted";
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 border-t border-border px-5 py-3 text-sm">
      <span className="text-muted-foreground">
        Page {Math.min(page, pages)} of {pages} · {total} {total === 1 ? "result" : "results"}
      </span>
      <span className="flex gap-2">
        {page > 1 ? (
          <Link href={href(page - 1)} className={link} rel="prev">
            Previous
          </Link>
        ) : (
          <span className={cn(link, "pointer-events-none opacity-40")}>Previous</span>
        )}
        {page < pages ? (
          <Link href={href(page + 1)} className={link} rel="next">
            Next
          </Link>
        ) : (
          <span className={cn(link, "pointer-events-none opacity-40")}>Next</span>
        )}
      </span>
    </nav>
  );
}
