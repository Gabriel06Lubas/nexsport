"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { cn } from "@/lib/utils";

import { bookCourt } from "../actions/book-court";

// The court availability grid: courts as columns, start times as rows. The
// server works out every cell (state and price) for the chosen booking
// length; this component only handles selection and hands the chosen slot
// to bookCourt, which holds it for 15 minutes and opens Stripe Checkout.

export type CourtColumn = { id: string; name: string };

export type GridCellView =
  | {
      state: "available";
      startTime: string;
      endTime: string;
      priceLabel: string;
    }
  | { state: "booked" }
  | { state: "unavailable"; label: string };

export type GridRowView = { time: string; cells: GridCellView[] };

type Selection = { court: number; row: number };

export function CourtScheduleGrid({
  courts,
  rows,
  date,
  dateLabel,
  duration,
}: {
  courts: CourtColumn[];
  rows: GridRowView[];
  /** The local date (YYYY-MM-DD) the grid shows. */
  date: string;
  /** The date as people read it, e.g. "Tue 18 Nov". */
  dateLabel: string;
  /** Booking length in minutes, the same for every cell. */
  duration: number;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Selection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // A new day or length: start over.
  useEffect(() => {
    setSelected(null);
    setError(null);
  }, [date, duration]);
  // Fresh availability (router.refresh): the selected slot may be gone; keep any message.
  useEffect(() => setSelected(null), [rows]);

  const span = duration / 30; // rows a booking covers
  const cell = selected ? rows[selected.row]?.cells[selected.court] : undefined;
  const choice = cell?.state === "available" && selected ? { ...cell, court: courts[selected.court]! } : null;

  function toggle(court: number, row: number) {
    setError(null);
    setSelected((s) => (s?.court === court && s.row === row ? null : { court, row }));
  }

  function checkout() {
    if (!choice) return;
    setError(null);
    startTransition(async () => {
      const result = await bookCourt({
        courtId: choice.court.id,
        date,
        startTime: choice.startTime,
        endTime: choice.endTime,
      });
      if (result.ok) {
        window.location.assign(result.checkoutUrl); // Stripe Checkout, another origin
        return;
      }
      setError(result.error);
      if (result.code === "SLOT_TAKEN" || result.code === "UNAVAILABLE") {
        setSelected(null);
        router.refresh(); // show what's free now
      }
    });
  }

  if (courts.length === 0) return <p className="text-sm text-muted-foreground">No courts take online bookings at this club yet.</p>;

  return (
    <div className={cn("space-y-3", choice && "pb-28")}>
      <Legend />
      {/* Scrolls both ways on its own, so the court names and the times stay pinned. */}
      <div className="max-h-[70vh] overflow-auto rounded-2xl border border-border bg-card" tabIndex={0} aria-label={`Court availability on ${dateLabel}`}>
        <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
          <caption className="sr-only">
            Courts on {dateLabel}, {duration}-minute bookings. Pick a start time.
          </caption>
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 top-0 z-30 w-16 border-b border-r border-border bg-card px-3 py-3 text-left text-xs font-medium text-muted-foreground">
                Time
              </th>
              {courts.map((c) => (
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
                    "sticky left-0 z-10 border-r border-border bg-card px-3 text-left align-top font-mono text-xs tabular-nums text-muted-foreground",
                    r.time.endsWith(":00") ? "pt-2" : "pt-2 text-muted-foreground/70",
                  )}
                >
                  {r.time}
                </th>
                {r.cells.map((c, ci) => {
                  const isStart = selected?.court === ci && selected.row === ri;
                  const covered = !!selected && selected.court === ci && ri > selected.row && ri < selected.row + span;
                  return (
                    <td key={courts[ci]!.id} className={cn("p-1", covered && "bg-select-soft")}>
                      <Cell cell={c} court={courts[ci]!.name} selected={isStart} covered={covered} onSelect={() => toggle(ci, ri)} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ActionBar choice={choice} dateLabel={dateLabel} pending={pending} error={error} onCheckout={checkout} onClear={() => setSelected(null)} />
    </div>
  );
}

function Cell({ cell, court, selected, covered, onSelect }: { cell: GridCellView; court: string; selected: boolean; covered: boolean; onSelect: () => void }) {
  const base = "flex h-12 w-full items-center justify-center rounded-xl text-xs transition";
  if (cell.state === "booked") {
    return (
      <div className={cn(base, "bg-muted text-muted-foreground/70 line-through decoration-muted-foreground/40")} aria-label={`${court}: booked`}>
        Booked
      </div>
    );
  }
  if (cell.state === "unavailable") {
    return (
      <div className={cn(base, covered ? "text-select" : "text-muted-foreground/50")} aria-label={`${court}: ${cell.label}`} title={cell.label}>
        –
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${court}, ${cell.startTime} to ${cell.endTime}, ${cell.priceLabel}`}
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

function ActionBar({
  choice,
  dateLabel,
  pending,
  error,
  onCheckout,
  onClear,
}: {
  choice: {
    court: CourtColumn;
    startTime: string;
    endTime: string;
    priceLabel: string;
  } | null;
  dateLabel: string;
  pending: boolean;
  error: string | null;
  onCheckout: () => void;
  onClear: () => void;
}) {
  // Stays mounted so it can slide; hidden from assistive tech and the tab order while down.
  const open = !!choice || !!error;
  return (
    <div
      aria-hidden={!open}
      inert={!open}
      className={cn(
        // Phones: just above the bottom tab bar (BottomNav, ~3.5rem + safe area); from lg, at the very bottom.
        "fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-40 border-t border-border bg-card/95 px-4 pb-4 pt-4 shadow-[0_-12px_32px_-16px_rgba(11,18,32,0.35)] backdrop-blur transition-transform duration-300 ease-out lg:bottom-0 lg:pb-[max(1rem,env(safe-area-inset-bottom))]",
        open ? "translate-y-0" : "translate-y-[calc(100%+5rem)]",
      )}
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
        <div className="min-w-0" aria-live="polite">
          {choice ? (
            <>
              <p className="truncate text-sm font-semibold">
                {choice.court.name} · {dateLabel} · {choice.startTime}–{choice.endTime}
              </p>
              <p className="text-xs text-muted-foreground">{choice.priceLabel} · held for 15 minutes while you pay</p>
            </>
          ) : null}
          {error && (
            <p role="alert" className="text-sm font-medium text-danger">
              {error}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {choice && (
            <button
              type="button"
              onClick={onClear}
              disabled={pending}
              className="h-11 rounded-full px-4 text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={onCheckout}
            disabled={!choice || pending}
            className="h-11 rounded-full bg-select px-5 text-sm font-semibold text-select-foreground shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Holding your court…" : "Proceed to Checkout"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Legend() {
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
