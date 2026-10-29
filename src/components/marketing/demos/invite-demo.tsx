"use client";

import { CalendarDays, Check, Clock, MapPin, RotateCcw, X } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Status = "INVITED" | "ACCEPTED" | "DECLINED";

const CAPACITY = 8;
const ALREADY_ACCEPTED = 6;

export function InviteDemo() {
  const [status, setStatus] = useState<Status>("INVITED");
  const seats = ALREADY_ACCEPTED + (status === "ACCEPTED" ? 1 : 0);

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Session invite from Coach Lucía</p>
          <h3 className="mt-1 text-lg font-semibold">U14 Padel: volleys & net play</h3>
        </div>
        {status === "INVITED" && <Badge variant="warning">Awaiting reply</Badge>}
        {status === "ACCEPTED" && <Badge variant="success">Going</Badge>}
        {status === "DECLINED" && <Badge variant="neutral">Declined</Badge>}
      </div>
      <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="size-4 text-muted-foreground" aria-hidden />
          <dt className="sr-only">Date</dt>
          <dd>Sat, 14 Mar</dd>
        </div>
        <div className="flex items-center gap-2">
          <Clock className="size-4 text-muted-foreground" aria-hidden />
          <dt className="sr-only">Time</dt>
          <dd>10:00–11:30</dd>
        </div>
        <div className="flex items-center gap-2">
          <MapPin className="size-4 text-muted-foreground" aria-hidden />
          <dt className="sr-only">Facility</dt>
          <dd>Court 2 · Padel Central</dd>
        </div>
      </dl>

      <div className="mt-4">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Seats</span>
          <span className="tabular-nums">
            {seats} / {CAPACITY} accepted
          </span>
        </div>
        <div className="mt-1.5 flex gap-[2px]" aria-hidden>
          {Array.from({ length: CAPACITY }, (_, i) => (
            <span key={i} className={i < seats ? "h-2 flex-1 rounded-full bg-chart-1" : "h-2 flex-1 rounded-full bg-muted"} />
          ))}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2" aria-live="polite">
        {status === "INVITED" ? (
          <>
            <Button onClick={() => setStatus("ACCEPTED")}>
              <Check /> Accept · €18.00
            </Button>
            <Button variant="outline" onClick={() => setStatus("DECLINED")}>
              <X /> Decline
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {status === "ACCEPTED"
                ? "Seat confirmed and paid. Coach Lucía has been notified, and the session is in your calendar."
                : "Coach Lucía has been notified. Your seat was released to the waitlist."}
            </p>
            <Button variant="ghost" size="sm" onClick={() => setStatus("INVITED")}>
              <RotateCcw /> Undo
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
