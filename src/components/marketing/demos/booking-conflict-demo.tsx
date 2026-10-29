"use client";

import { AlertTriangle, CheckCircle2, RotateCcw } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  availableUnits,
  findFacilityConflicts,
  type EquipmentReservation,
  type FacilityBooking,
} from "@/modules/scheduling/lib/overlap";

const DAY_START = 8;
const DAY_END = 22;
const at = (hours: number) => new Date(Date.UTC(2030, 0, 7, Math.floor(hours), Math.round((hours % 1) * 60)));
const hourOf = (d: Date) => d.getUTCHours() + d.getUTCMinutes() / 60;
const label = (hours: number) => `${String(Math.floor(hours)).padStart(2, "0")}:${hours % 1 ? "30" : "00"}`;

const courts = [
  { id: "court-1", name: "Court 1" },
  { id: "court-2", name: "Court 2" },
  { id: "court-3", name: "Court 3" },
];

type DemoSession = FacilityBooking & { title: string };

const initialSessions: DemoSession[] = [
  { id: "s1", facilityId: "court-1", title: "U14 drills", status: "SCHEDULED", startsAt: at(9), endsAt: at(10.5) },
  { id: "s2", facilityId: "court-1", title: "Adult clinic", status: "SCHEDULED", startsAt: at(17), endsAt: at(18.5) },
  { id: "s3", facilityId: "court-2", title: "Private lesson", status: "SCHEDULED", startsAt: at(10), endsAt: at(11) },
  { id: "s4", facilityId: "court-2", title: "Ladies league", status: "SCHEDULED", startsAt: at(18), endsAt: at(20) },
  { id: "s5", facilityId: "court-3", title: "Juniors", status: "SCHEDULED", startsAt: at(16), endsAt: at(17.5) },
];

const initialReservations: EquipmentReservation[] = [
  { equipmentId: "machine", quantity: 1, status: "RESERVED", startsAt: at(17), endsAt: at(18.5) },
  { equipmentId: "tubes", quantity: 8, status: "RESERVED", startsAt: at(16), endsAt: at(17.5) },
];

const startOptions = Array.from({ length: (DAY_END - DAY_START) * 2 }, (_, i) => DAY_START + i / 2);

export function BookingConflictDemo() {
  const [sessions, setSessions] = useState(initialSessions);
  const [reservations, setReservations] = useState(initialReservations);
  const [courtId, setCourtId] = useState("court-1");
  const [start, setStart] = useState(17.5);
  const [duration, setDuration] = useState(1);
  const [wantMachine, setWantMachine] = useState(true);
  const [tubes, setTubes] = useState(4);
  const [booked, setBooked] = useState<string | null>(null);

  const end = Math.min(start + duration, DAY_END);
  const slot = { startsAt: at(start), endsAt: at(end) };

  // Cheap enough to recompute on every render.
  const check = (() => {
    const conflicts = findFacilityConflicts(sessions, { facilityId: courtId, ...slot });
    const machineFree = availableUnits(1, reservations, "machine", slot);
    const tubesFree = availableUnits(12, reservations, "tubes", slot);
    const problems: string[] = conflicts.map(
      (c) => `${courts.find((f) => f.id === c.facilityId)?.name} is taken by “${c.title}” ${label(hourOf(c.startsAt))}–${label(hourOf(c.endsAt))}`,
    );
    if (wantMachine && machineFree < 1) problems.push("The ball machine is already reserved for an overlapping session");
    if (tubes > tubesFree) problems.push(`Only ${tubesFree} of 12 ball tubes are free in this window`);
    return { problems, machineFree, tubesFree };
  })();

  function reserve() {
    if (check.problems.length) return;
    const id = `new-${sessions.length}`;
    setSessions((s) => [...s, { id, facilityId: courtId, title: "Your session", status: "SCHEDULED", ...slot }]);
    setReservations((r) => [
      ...r,
      ...(wantMachine ? [{ equipmentId: "machine", quantity: 1, status: "RESERVED" as const, ...slot }] : []),
      ...(tubes > 0 ? [{ equipmentId: "tubes", quantity: tubes, status: "RESERVED" as const, ...slot }] : []),
    ]);
    setBooked(`${courts.find((c) => c.id === courtId)?.name}, ${label(start)}–${label(end)}`);
  }

  function reset() {
    setSessions(initialSessions);
    setReservations(initialReservations);
    setBooked(null);
  }

  const pct = (h: number) => ((h - DAY_START) / (DAY_END - DAY_START)) * 100;
  const ok = check.problems.length === 0;

  return (
    <div className="rounded-2xl border border-border bg-card">
      <div className="overflow-x-auto p-4 sm:p-6">
        <div className="min-w-[560px]">
          <div className="ml-20 flex justify-between text-[10px] tabular-nums text-muted-foreground" aria-hidden>
            {Array.from({ length: (DAY_END - DAY_START) / 2 + 1 }, (_, i) => (
              <span key={i}>{label(DAY_START + i * 2)}</span>
            ))}
          </div>
          <ul className="mt-2 space-y-2" aria-label="Today's court schedule">
            {courts.map((court) => (
              <li key={court.id} className="flex items-center gap-3">
                <span className="w-17 shrink-0 text-sm font-medium">{court.name}</span>
                <div className="relative h-11 flex-1 rounded-lg bg-muted">
                  {sessions
                    .filter((s) => s.facilityId === court.id)
                    .map((s) => (
                      <div
                        key={s.id}
                        className={cn(
                          "absolute inset-y-1 overflow-hidden rounded-md px-2 py-1 text-[11px] leading-tight",
                          s.id.startsWith("new") ? "bg-lime text-lime-foreground" : "bg-ink text-ink-foreground",
                        )}
                        style={{ left: `${pct(hourOf(s.startsAt))}%`, width: `${pct(hourOf(s.endsAt)) - pct(hourOf(s.startsAt))}%` }}
                      >
                        <span className="block truncate font-semibold">{s.title}</span>
                        <span className="block truncate opacity-75">
                          {label(hourOf(s.startsAt))}–{label(hourOf(s.endsAt))}
                        </span>
                      </div>
                    ))}
                  {court.id === courtId && (
                    <div
                      aria-hidden
                      className={cn(
                        "pointer-events-none absolute inset-y-0 rounded-lg border-2 border-dashed",
                        ok ? "border-chart-1 bg-chart-1/10" : "border-danger bg-danger/10",
                      )}
                      style={{ left: `${pct(start)}%`, width: `${pct(end) - pct(start)}%` }}
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="grid gap-6 border-t border-border p-4 sm:p-6 lg:grid-cols-[1fr_1fr]">
        <form className="grid grid-cols-2 gap-3" onSubmit={(e) => (e.preventDefault(), reserve())}>
          <label className="col-span-2 text-sm sm:col-span-1">
            <span className="text-muted-foreground">Facility</span>
            <select value={courtId} onChange={(e) => setCourtId(e.target.value)} className="mt-1 h-10 w-full rounded-lg border border-border bg-card px-3">
              {courts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="text-muted-foreground">Start</span>
            <select value={start} onChange={(e) => setStart(Number(e.target.value))} className="mt-1 h-10 w-full rounded-lg border border-border bg-card px-3">
              {startOptions.map((h) => (
                <option key={h} value={h}>
                  {label(h)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="text-muted-foreground">Duration</span>
            <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="mt-1 h-10 w-full rounded-lg border border-border bg-card px-3">
              {[0.5, 1, 1.5, 2].map((d) => (
                <option key={d} value={d}>
                  {d * 60} min
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="text-muted-foreground">Ball tubes ({check.tubesFree} free)</span>
            <input
              type="number"
              min={0}
              max={12}
              value={tubes}
              onChange={(e) => setTubes(Math.max(0, Math.min(12, Number(e.target.value) || 0)))}
              className="mt-1 h-10 w-full rounded-lg border border-border bg-card px-3 tabular-nums"
            />
          </label>
          <label className="col-span-2 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={wantMachine} onChange={(e) => setWantMachine(e.target.checked)} className="size-4 accent-[var(--chart-1)]" />
            Reserve the ball machine ({check.machineFree} of 1 free)
          </label>
          <div className="col-span-2 flex flex-wrap gap-2">
            <Button type="submit" disabled={!ok}>
              Reserve slot
            </Button>
            <Button type="button" variant="outline" onClick={reset}>
              <RotateCcw /> Reset
            </Button>
          </div>
        </form>

        <div aria-live="polite" className="text-sm">
          {ok ? (
            <div className="rounded-xl bg-success-soft p-4 text-success">
              <p className="flex items-center gap-2 font-semibold">
                <CheckCircle2 className="size-4" aria-hidden /> Slot available
              </p>
              <p className="mt-1 text-foreground/80">
                {courts.find((c) => c.id === courtId)?.name}, {label(start)}–{label(end)}. Facility and equipment are free.
              </p>
            </div>
          ) : (
            <div className="rounded-xl bg-danger-soft p-4 text-danger">
              <p className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="size-4" aria-hidden /> Can’t book this slot
              </p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-foreground/80">
                {check.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          )}
          {booked && <p className="mt-3 text-muted-foreground">Reserved: {booked}. Try booking the same slot again.</p>}
          <p className="mt-3 text-xs text-muted-foreground">
            In the product this check is enforced by the database itself, so two coaches booking at the same moment can never both get
            the slot.
          </p>
        </div>
      </div>
    </div>
  );
}
