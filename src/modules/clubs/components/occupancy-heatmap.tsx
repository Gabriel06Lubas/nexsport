"use client";

import { useState } from "react";

// Peak hours: share of facility time booked per weekday and hour, over the
// last four weeks. Sequential, one hue (--chart-1) from light to dark.

const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

export type HeatCell = { dow: number; hour: number; minutes: number };

export function OccupancyHeatmap({ cells, facilities, fromHour, toHour }: { cells: HeatCell[]; facilities: number; fromHour: number; toHour: number }) {
  // Four of each weekday in 28 days; each facility offers 60 minutes per hour slot.
  const capacity = Math.max(1, facilities) * 4 * 60;
  const share = new Map(cells.map((c) => [`${c.dow}:${c.hour}`, Math.min(1, c.minutes / capacity)]));
  const hours = Array.from({ length: Math.max(0, toHour - fromHour) }, (_, i) => fromHour + i);
  const [active, setActive] = useState<{ dow: number; hour: number } | null>(null);
  const peak = [...share.entries()].sort((a, b) => b[1] - a[1])[0];
  const describe = (dow: number, hour: number) => {
    const s = share.get(`${dow}:${hour}`) ?? 0;
    return `${dayNames[dow - 1]} ${hh(hour)}–${hh(hour + 1)}: ${Math.round(s * 100)}% booked`;
  };

  return (
    <div className="space-y-3 p-5">
      <p aria-live="polite" className="min-h-5 text-sm">
        {active ? (
          describe(active.dow, active.hour)
        ) : peak && peak[1] > 0 ? (
          <>Busiest: {describe(Number(peak[0].split(":")[0]), Number(peak[0].split(":")[1]))}</>
        ) : (
          <span className="text-muted-foreground">No bookings in the last four weeks yet.</span>
        )}
      </p>
      <div className="relative overflow-x-auto">
        <div
          className="grid min-w-[300px] gap-[2px] text-[10px] text-muted-foreground"
          style={{ gridTemplateColumns: `2.5rem repeat(${hours.length}, minmax(0, 1fr))` }}
          onMouseLeave={() => setActive(null)}
          role="img"
          aria-label={`Occupancy heatmap by weekday and hour.${peak && peak[1] > 0 ? ` Busiest slot: ${describe(Number(peak[0].split(":")[0]), Number(peak[0].split(":")[1]))}.` : ""}`}
        >
          <span />
          {hours.map((h) => (
            <span key={h} className="text-center">{(h - fromHour) % 3 === 0 ? hh(h).slice(0, 2) : ""}</span>
          ))}
          {days.map((d, di) => (
            <div key={d} className="contents">
              <span className="self-center">{d}</span>
              {hours.map((h) => {
                const s = share.get(`${di + 1}:${h}`) ?? 0;
                return (
                  <span
                    key={h}
                    title={describe(di + 1, h)}
                    onMouseEnter={() => setActive({ dow: di + 1, hour: h })}
                    className="h-6 rounded-[3px]"
                    style={{ background: s > 0 ? `color-mix(in oklab, var(--chart-1) ${Math.round(12 + s * 88)}%, var(--card))` : "var(--muted)" }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground" aria-hidden>
        <span>0%</span>
        <span className="h-2 w-28 rounded-full" style={{ background: "linear-gradient(to right, color-mix(in oklab, var(--chart-1) 12%, var(--card)), var(--chart-1))" }} />
        <span>100% of courts booked</span>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Show as table</summary>
        <div className="relative mt-2 overflow-x-auto">
          <table className="text-xs tabular-nums">
            <thead>
              <tr>
                <th scope="col" className="pr-2 text-left font-medium">Hour</th>
                {days.map((d) => (
                  <th key={d} scope="col" className="px-1.5 font-medium">{d}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {hours.map((h) => (
                <tr key={h}>
                  <th scope="row" className="pr-2 text-left font-normal">{hh(h)}</th>
                  {days.map((d, di) => (
                    <td key={d} className="px-1.5 text-right">{Math.round((share.get(`${di + 1}:${h}`) ?? 0) * 100)}%</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
