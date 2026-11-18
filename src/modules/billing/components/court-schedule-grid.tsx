"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { barPrimary, barSecondary, BookingBar, SlotGrid, useSlotSelection, type SlotColumn, type SlotRow } from "@/components/booking/slot-grid";
import { cn } from "@/lib/utils";

import { bookCourt } from "../actions/book-court";

// The court availability grid: courts as columns, start times as rows. The
// server works out every cell (state and price) for the chosen booking
// length; this component only handles selection and hands the chosen slot
// to bookCourt, which holds it for 15 minutes and opens Stripe Checkout.

export function CourtScheduleGrid({
  courts,
  rows,
  date,
  dateLabel,
  duration,
}: {
  courts: SlotColumn[];
  rows: SlotRow[];
  /** The local date (YYYY-MM-DD) the grid shows. */
  date: string;
  /** The date as people read it, e.g. "Tue 18 Nov". */
  dateLabel: string;
  /** Booking length in minutes, the same for every cell. */
  duration: number;
}) {
  const router = useRouter();
  const { selected, choice, error, setError, toggle, clear } = useSlotSelection(rows, courts, `${date}:${duration}`);
  const [pending, startTransition] = useTransition();

  function checkout() {
    if (!choice) return;
    setError(null);
    startTransition(async () => {
      const result = await bookCourt({ courtId: choice.column.id, date, startTime: choice.startTime, endTime: choice.endTime });
      if (result.ok) {
        window.location.assign(result.checkoutUrl); // Stripe Checkout, another origin
        return;
      }
      setError(result.error);
      if (result.code === "SLOT_TAKEN" || result.code === "UNAVAILABLE") {
        clear();
        router.refresh(); // show what's free now
      }
    });
  }

  if (courts.length === 0) return <p className="text-sm text-muted-foreground">No courts take online bookings at this club yet.</p>;

  return (
    <div className={cn(choice && "pb-28")}>
      <SlotGrid
        columns={courts}
        rows={rows}
        label={`Court availability on ${dateLabel}`}
        caption={`Courts on ${dateLabel}, ${duration}-minute bookings. Pick a start time.`}
        selected={selected}
        span={duration / 30}
        onSelect={toggle}
      />
      <BookingBar
        aboveTabBar
        open={!!choice || !!error}
        title={choice && `${choice.column.name} · ${dateLabel} · ${choice.startTime}–${choice.endTime}`}
        detail={choice && `${choice.priceLabel} · held for 15 minutes while you pay`}
        error={error}
        actions={
          <>
            {choice && (
              <button type="button" onClick={clear} disabled={pending} className={barSecondary}>
                Clear
              </button>
            )}
            <button type="button" onClick={checkout} disabled={!choice || pending} className={barPrimary}>
              {pending ? "Holding your court…" : "Proceed to Checkout"}
            </button>
          </>
        }
      />
    </div>
  );
}
