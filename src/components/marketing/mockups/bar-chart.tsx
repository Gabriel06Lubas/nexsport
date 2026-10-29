"use client";

import { useState } from "react";

/**
 * Single-series bar chart. One hue (--chart-1), so no legend: the title names
 * the series. Hover/focus shows a tooltip; a visually hidden table carries the
 * same data for screen readers.
 */
export function BarChart({
  title,
  data,
  max,
  suffix = "",
  height = 160,
}: {
  title: string;
  data: { label: string; value: number }[];
  max?: number;
  /** Appended to every value, e.g. "%". (Props must be serialisable: no formatter functions.) */
  suffix?: string;
  height?: number;
}) {
  const format = (v: number) => `${v}${suffix}`;
  const [active, setActive] = useState<number | null>(null);
  const top = max ?? Math.max(...data.map((d) => d.value));
  const gridSteps = [0, 0.5, 1];

  return (
    <div>
      <p className="text-sm font-medium">{title}</p>
      <div className="relative mt-6" style={{ height }}>
        {gridSteps.map((g) => (
          <div key={g} aria-hidden className="absolute inset-x-0 flex items-center gap-2" style={{ bottom: `${g * 100}%` }}>
            <span className="w-9 -translate-y-1/2 text-right text-[10px] tabular-nums text-muted-foreground">{format(Math.round(top * g))}</span>
            <span className="h-px flex-1 -translate-y-1/2 bg-border/70" />
          </div>
        ))}
        <div aria-hidden className="absolute inset-y-0 left-11 right-0 flex items-end gap-[2px]">
          {data.map((d, i) => (
            <div
              key={d.label}
              className="group relative flex h-full flex-1 items-end"
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
            >
              <div
                className="w-full rounded-t-[4px] bg-chart-1 transition-opacity"
                style={{ height: `${(d.value / top) * 100}%`, opacity: active === null || active === i ? 1 : 0.45 }}
              />
              {active === i && (
                <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-card px-2 py-1 text-xs shadow-md">
                  <span className="text-muted-foreground">{d.label}</span> <span className="font-semibold tabular-nums">{format(d.value)}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <div aria-hidden className="ml-11 mt-2 flex gap-[2px]">
        {data.map((d) => (
          <span key={d.label} className="flex-1 truncate text-center text-[10px] text-muted-foreground">
            {d.label}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>{title}</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.label}>
              <th scope="row">{d.label}</th>
              <td>{format(d.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
