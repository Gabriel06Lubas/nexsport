"use client";

import { useEffect, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

// The booking grid shared by Book a court (courts × start times) and a
// coach's public page (clubs × start times): columns, rows of start times,
// cells that are available (with a price), booked or unavailable, one
// selected cell with an indigo glow, and a bar that slides up from the
// bottom with what's selected and the button to book it. The server works
// out every cell; these components only render them and track the selection.

export type SlotColumn = { id: string; name: string };

export type SlotCell =
  | {
      state: "available";
      startTime: string;
      endTime: string;
      priceLabel: string;
      /** Whatever the booking action needs to identify the slot (e.g. its start instant). */
      value?: string;
    }
  | { state: "booked" }
  | { state: "unavailable"; label: string };

export type SlotRow = { time: string; cells: SlotCell[] };

export type SlotSelection = { column: number; row: number };

/**
 * The selected cell. Cleared when `resetKey` changes (another day or length)
 * and when fresh rows arrive (router.refresh: the slot may be gone).
 */
export function useSlotSelection(rows: SlotRow[], columns: SlotColumn[], resetKey: string) {
  const [selected, setSelected] = useState<SlotSelection | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setSelected(null);
    setError(null);
  }, [resetKey]);
  useEffect(() => setSelected(null), [rows]);

  const cell = selected ? rows[selected.row]?.cells[selected.column] : undefined;
  const choice = cell?.state === "available" && selected ? { ...cell, column: columns[selected.column]! } : null;
  return {
    selected,
    choice,
    error,
    setError,
    clear: () => setSelected(null),
    toggle: (column: number, row: number) => {
      setError(null);
      setSelected((s) => (s?.column === column && s.row === row ? null : { column, row }));
    },
  };
}

export function SlotGrid({
  columns,
  rows,
  label,
  caption,
  selected,
  span = 1,
  onSelect,
  timeHeading = "Time",
}: {
  columns: SlotColumn[];
  rows: SlotRow[];
  /** Accessible name of the scrolling region, e.g. "Court availability on Tue 18 Nov". */
  label: string;
  caption: string;
  selected: SlotSelection | null;
  /** Rows one booking covers (a 90-minute court on 30-minute rows: 3); the ones after the selected cell are tinted. */
  span?: number;
  onSelect: (column: number, row: number) => void;
  timeHeading?: string;
}) {
  return (
    <div className="space-y-3">
      <SlotLegend />
      {/* Scrolls both ways on its own, so the column names and the times stay pinned. */}
      <div className="max-h-[70vh] overflow-auto rounded-2xl border border-border bg-card" tabIndex={0} aria-label={label}>
        <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 top-0 z-30 w-16 border-b border-r border-border bg-card px-3 py-3 text-left text-xs font-medium text-muted-foreground">
                {timeHeading}
              </th>
              {columns.map((c) => (
                <th key={c.id} scope="col" className="sticky top-0 z-20 min-w-28 border-b border-border bg-card px-2 py-3 text-center text-xs font-semibold sm:min-w-32">
                  {c.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={r.time}>
                <th
                  scope="row"
                  className={cn(
                    "sticky left-0 z-10 border-r border-border bg-card px-3 pt-2 text-left align-top font-mono text-xs tabular-nums text-muted-foreground",
                    !r.time.endsWith(":00") && "text-muted-foreground/70",
                  )}
                >
                  {r.time}
                </th>
                {r.cells.map((c, ci) => {
                  const isStart = selected?.column === ci && selected.row === ri;
                  const covered = !!selected && selected.column === ci && ri > selected.row && ri < selected.row + span;
                  return (
                    <td key={columns[ci]!.id} className={cn("p-1", covered && "bg-select-soft")}>
                      <Cell cell={c} column={columns[ci]!.name} selected={isStart} covered={covered} onSelect={() => onSelect(ci, ri)} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Cell({ cell, column, selected, covered, onSelect }: { cell: SlotCell; column: string; selected: boolean; covered: boolean; onSelect: () => void }) {
  const base = "flex h-12 w-full items-center justify-center rounded-xl text-xs transition";
  if (cell.state === "booked") {
    return (
      <div className={cn(base, "bg-muted text-muted-foreground/70 line-through decoration-muted-foreground/40")} aria-label={`${column}: booked`}>
        Booked
      </div>
    );
  }
  if (cell.state === "unavailable") {
    return (
      <div className={cn(base, covered ? "text-select" : "text-muted-foreground/50")} aria-label={`${column}: ${cell.label}`} title={cell.label}>
        –
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${column}, ${cell.startTime} to ${cell.endTime}, ${cell.priceLabel}`}
      className={cn(
        base,
        "border font-semibold tabular-nums",
        selected
          ? "border-select bg-select text-select-foreground shadow-[0_0_0_4px_var(--select-soft),0_8px_24px_-8px_var(--select)]"
          : covered
            ? "border-transparent bg-transparent text-select"
            : "border-border bg-background hover:border-select hover:text-select focus-visible:border-select",
      )}
    >
      {cell.priceLabel}
    </button>
  );
}

/**
 * The bar that slides up while something is selected (or an error needs
 * showing). It stays mounted so it can slide, and is hidden from assistive
 * tech and the tab order while down.
 */
export function BookingBar({
  open,
  title,
  detail,
  error,
  actions,
  aboveTabBar = false,
}: {
  open: boolean;
  title?: ReactNode;
  detail?: ReactNode;
  error?: string | null;
  actions: ReactNode;
  /** Dashboard pages have a bottom tab bar on phones (BottomNav, ~3.5rem + safe area): sit just above it. */
  aboveTabBar?: boolean;
}) {
  return (
    <div
      aria-hidden={!open}
      inert={!open}
      className={cn(
        "fixed inset-x-0 z-40 border-t border-border bg-card/95 px-4 pt-4 shadow-[0_-12px_32px_-16px_rgba(11,18,32,0.35)] backdrop-blur transition-transform duration-300 ease-out",
        aboveTabBar ? "bottom-[calc(3.5rem+env(safe-area-inset-bottom))] pb-4 lg:bottom-0 lg:pb-[max(1rem,env(safe-area-inset-bottom))]" : "bottom-0 pb-[max(1rem,env(safe-area-inset-bottom))]",
        open ? "translate-y-0" : "translate-y-[calc(100%+5rem)]",
      )}
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
        <div className="min-w-0" aria-live="polite">
          {title && <p className="truncate text-sm font-semibold">{title}</p>}
          {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
          {error && (
            <p role="alert" className="text-sm font-medium text-danger">
              {error}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      </div>
    </div>
  );
}

export const barPrimary =
  "inline-flex h-11 items-center rounded-full bg-select px-5 text-sm font-semibold text-select-foreground shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";
export const barSecondary = "h-11 rounded-full px-4 text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-50";

export function SlotLegend() {
  const dot = "inline-block size-3 rounded-[4px] border";
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <li className="flex items-center gap-1.5">
        <span className={cn(dot, "border-border bg-background")} /> Available
      </li>
      <li className="flex items-center gap-1.5">
        <span className={cn(dot, "border-select bg-select")} /> Selected
      </li>
      <li className="flex items-center gap-1.5">
        <span className={cn(dot, "border-transparent bg-muted")} /> Booked
      </li>
    </ul>
  );
}
