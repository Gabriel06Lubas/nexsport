"use client";

import { useState } from "react";

import { cn, formatMoney } from "@/lib/utils";

// Monthly club revenue, stacked by stream. Colours are --chart-1..3, validated
// together for colour-vision deficiency in this order (adjacent pairs).
// Identity never relies on colour alone: legend + hover readout + table view.

export type RevenuePoint = { month: string; rentals: number; coaching: number; memberships: number };

const series = [
  { key: "rentals", label: "Court rentals", color: "var(--chart-1)" },
  { key: "coaching", label: "Coaching commissions", color: "var(--chart-2)" },
  { key: "memberships", label: "Memberships", color: "var(--chart-3)" },
] as const;

const monthLabel = (month: string, style: "short" | "long" = "short") =>
  new Intl.DateTimeFormat("en-GB", { month: style, year: style === "long" ? "numeric" : undefined, timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));

const total = (p: RevenuePoint) => p.rentals + p.coaching + p.memberships;

export function RevenueChart({ data, currency }: { data: RevenuePoint[]; currency: string }) {
  const [active, setActive] = useState(data.length - 1);
  const max = Math.max(1, ...data.map(total));
  const shown = data[active] ?? data[data.length - 1];
  const money = (n: number) => formatMoney(n, currency);

  return (
    <div className="space-y-4 p-5">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
        {series.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />
            {s.label}
          </li>
        ))}
      </ul>

      {shown && (
        <div aria-live="polite" className="min-h-12 text-sm">
          <p className="font-medium">
            {monthLabel(shown.month, "long")} · <span className="tabular-nums">{money(total(shown))}</span>
          </p>
          <p className="text-xs text-muted-foreground tabular-nums">
            {series.map((s) => `${s.label} ${money(shown[s.key])}`).join(" · ")}
          </p>
        </div>
      )}

      <div className="relative h-40" role="img" aria-label={`Revenue by month, ${data.map((p) => `${monthLabel(p.month)} ${money(total(p))}`).join(", ")}`}>
        <div className="absolute inset-x-0 top-0 border-t border-dashed border-border" aria-hidden />
        <div className="absolute inset-x-0 bottom-0 border-t border-border" aria-hidden />
        <div className="absolute inset-0 flex items-end gap-2 sm:gap-4">
          {data.map((p, i) => (
            <button
              key={p.month}
              type="button"
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onClick={() => setActive(i)}
              aria-label={`${monthLabel(p.month, "long")}: ${money(total(p))}`}
              className={cn("flex h-full min-w-0 flex-1 flex-col-reverse items-stretch gap-[2px] rounded-sm px-1 sm:px-3", i === active && "bg-muted/60")}
            >
              {series.map((s, si) => {
                const value = p[s.key];
                if (value <= 0) return null;
                const isTop = series.slice(si + 1).every((later) => p[later.key] <= 0);
                return <span key={s.key} className={cn("block w-full", isTop && "rounded-t-[4px]")} style={{ height: `${(value / max) * 100}%`, background: s.color }} />;
              })}
            </button>
          ))}
        </div>
      </div>
      <div className="flex gap-2 text-center text-xs text-muted-foreground sm:gap-4" aria-hidden>
        {data.map((p) => (
          <span key={p.month} className="min-w-0 flex-1">
            {monthLabel(p.month)}
          </span>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Top line: {money(max)}</p>

      <details className="text-sm">
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Show as table</summary>
        <div className="relative mt-2 overflow-x-auto">
          <table className="w-full min-w-[480px] text-xs">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th scope="col" className="py-1 pr-3 font-medium">Month</th>
                {series.map((s) => (
                  <th key={s.key} scope="col" className="py-1 pr-3 font-medium">{s.label}</th>
                ))}
                <th scope="col" className="py-1 font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {data.map((p) => (
                <tr key={p.month}>
                  <th scope="row" className="py-1 pr-3 text-left font-normal">{monthLabel(p.month, "long")}</th>
                  {series.map((s) => (
                    <td key={s.key} className="py-1 pr-3">{money(p[s.key])}</td>
                  ))}
                  <td className="py-1 font-medium">{money(total(p))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
