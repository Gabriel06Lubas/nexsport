"use client";

import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { barPrimary, barSecondary, BookingBar, SlotGrid, useSlotSelection, type SlotColumn, type SlotRow } from "@/components/booking/slot-grid";
import { cn } from "@/lib/utils";

import { bookSlot } from "../actions/booking";

// A coach's open private sessions for one day, in the same grid as Book a
// court: the clubs they teach at as columns, session start times as rows.
// Picking a slot slides up the bar; "Book session" calls bookSlot, which
// re-checks the slot on the server and redirects back with the confirmation.

export function CoachScheduleGrid({
  coachSlug,
  clubs,
  rows,
  day,
  dateLabel,
  sessionMinutes,
  mode,
  signInHref,
}: {
  coachSlug: string;
  clubs: SlotColumn[];
  rows: SlotRow[];
  /** The local date (YYYY-MM-DD) shown. */
  day: string;
  dateLabel: string;
  sessionMinutes: number;
  /** book: a signed-in student · sign-in: a visitor · own: the coach looking at their own page. */
  mode: "book" | "sign-in" | "own";
  signInHref: Route;
}) {
  const router = useRouter();
  const { selected, choice, error, setError, toggle, clear } = useSlotSelection(rows, clubs, day);
  const [pending, startTransition] = useTransition();

  function book() {
    if (!choice?.value || mode !== "book") return;
    setError(null);
    const form = new FormData();
    form.set("coachSlug", coachSlug);
    form.set("clubId", choice.column.id);
    form.set("startsAt", choice.value);
    startTransition(async () => {
      // On success bookSlot redirects to the confirmation; anything returned is a refusal.
      const result = await bookSlot({}, form);
      if (result?.error) {
        setError(result.error);
        clear();
        router.refresh(); // the slot may be gone: show what's open now
      }
    });
  }

  return (
    <div className={cn(choice && "pb-28")}>
      <SlotGrid
        columns={clubs}
        rows={rows}
        label={`Open sessions on ${dateLabel}`}
        caption={`Private ${sessionMinutes}-minute sessions on ${dateLabel}, by club. Pick a start time.`}
        selected={selected}
        onSelect={toggle}
      />
      <BookingBar
        open={!!choice || !!error}
        title={choice && `${choice.column.name} · ${dateLabel} · ${choice.startTime}–${choice.endTime}`}
        detail={choice && (mode === "own" ? "This is your booking page, as students see it." : `${choice.priceLabel} · private session, paid at the club`)}
        error={error}
        actions={
          <>
            {choice && (
              <button type="button" onClick={clear} disabled={pending} className={barSecondary}>
                Clear
              </button>
            )}
            {mode === "sign-in" ? (
              <Link href={signInHref} className={barPrimary}>
                Sign in to book
              </Link>
            ) : mode === "book" ? (
              <button type="button" onClick={book} disabled={!choice || pending} className={barPrimary}>
                {pending ? "Booking…" : "Book session"}
              </button>
            ) : null}
          </>
        }
      />
    </div>
  );
}
