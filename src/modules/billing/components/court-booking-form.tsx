"use client";

import { useActionState } from "react";

import { formatMoney } from "@/lib/utils";

import { createCourtBookingAction, type CourtBookingState } from "../actions/booking-actions";
import { PaymentStep } from "./payment-step";

type Facility = { facilityId: string; label: string };

/**
 * Step 1: pick a court and a time; the server holds it and creates the
 * PaymentIntent. Step 2: pay with the Payment Element.
 */
export function CourtBookingForm({ facilities, publishableKey, defaultDate }: { facilities: Facility[]; publishableKey: string; defaultDate: string }) {
  const [state, action, pending] = useActionState<CourtBookingState, FormData>(createCourtBookingAction, {});

  if (state.payment) {
    return (
      <div className="space-y-4">
        <p role="status" className="rounded-xl border border-border bg-muted/50 px-4 py-3 text-sm">
          {state.ok}
        </p>
        <PaymentStep
          publishableKey={publishableKey}
          clientSecret={state.payment.clientSecret}
          returnPath={`/dashboard/student/bookings?booking=${state.payment.bookingId}`}
          amountLabel={formatMoney(state.payment.amount, state.payment.currency)}
          holdExpiresAt={state.payment.holdExpiresAt}
        />
      </div>
    );
  }

  return (
    <form action={action} noValidate aria-label="Book a court" className="space-y-4">
      <FormFields state={state} facilities={facilities} defaultDate={defaultDate} pending={pending} />
    </form>
  );
}

function FormFields({ state, facilities, defaultDate, pending }: { state: CourtBookingState; facilities: Facility[]; defaultDate: string; pending: boolean }) {
  const v = state.values ?? {};
  const e = state.fieldErrors ?? {};
  const input = "mt-1 h-10 w-full min-w-0 rounded-xl border border-border bg-background px-3 text-sm aria-[invalid=true]:border-danger";
  const err = (name: string) => (e[name] ? <span className="mt-1 block text-xs text-danger">{e[name]}</span> : null);
  const key = JSON.stringify(v);
  return (
    <>
      <label className="block text-sm">
        <span className="font-medium">Court</span>
        <select key={`f${key}`} name="facilityId" defaultValue={v.facilityId ?? facilities[0]?.facilityId} aria-invalid={Boolean(e.facilityId)} className={input}>
          {facilities.map((f) => (
            <option key={f.facilityId} value={f.facilityId}>
              {f.label}
            </option>
          ))}
        </select>
        {err("facilityId")}
      </label>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <label className="block text-sm">
          <span className="font-medium">Date</span>
          <input key={`d${key}`} type="date" name="date" defaultValue={v.date ?? defaultDate} min={defaultDate} aria-invalid={Boolean(e.date)} className={input} />
          {err("date")}
        </label>
        <label className="block text-sm">
          <span className="font-medium">From</span>
          <input key={`s${key}`} type="time" step={900} name="startTime" defaultValue={v.startTime ?? "18:00"} aria-invalid={Boolean(e.startTime)} className={input} />
          {err("startTime")}
        </label>
        <label className="block text-sm">
          <span className="font-medium">Until</span>
          <input key={`e${key}`} type="time" step={900} name="endTime" defaultValue={v.endTime ?? "19:30"} aria-invalid={Boolean(e.endTime)} className={input} />
          {err("endTime")}
        </label>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p aria-live="polite" className="min-h-5 min-w-0 flex-1 text-sm">
          {state.error && <span className="text-danger">{state.error}</span>}
        </p>
        <button type="submit" disabled={pending} className="h-9 rounded-full bg-ink px-4 text-sm font-semibold text-ink-foreground disabled:opacity-50">
          {pending ? "Holding the court…" : "Continue to payment"}
        </button>
      </div>
    </>
  );
}

