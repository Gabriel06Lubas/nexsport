"use client";

import { Star } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

type Mark = "PRESENT" | "LATE" | "ABSENT" | "EXCUSED";

const marks: { value: Mark; label: string; active: string }[] = [
  { value: "PRESENT", label: "Present", active: "bg-success-soft text-success border-transparent" },
  { value: "LATE", label: "Late", active: "bg-warning-soft text-warning border-transparent" },
  { value: "ABSENT", label: "Absent", active: "bg-danger-soft text-danger border-transparent" },
  { value: "EXCUSED", label: "Excused", active: "bg-muted text-foreground border-transparent" },
];

const roster = ["Sara Ortiz", "Leo Martín", "Noa Kim", "Iván Ruiz", "Emma Weber"];

export function AttendanceDemo() {
  const [attendance, setAttendance] = useState<Record<string, Mark>>({ "Sara Ortiz": "PRESENT", "Leo Martín": "LATE" });
  const [ratings, setRatings] = useState<Record<string, number>>({ "Sara Ortiz": 4 });

  const counts = marks.map((m) => ({ ...m, n: Object.values(attendance).filter((v) => v === m.value).length }));

  return (
    <div className="rounded-2xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-4 sm:px-5">
        <p className="text-sm font-semibold">U14 Padel · Sat 10:00 · Attendance</p>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {counts.map((c) => `${c.n} ${c.label.toLowerCase()}`).join(" · ")}
        </p>
      </div>
      <ul className="divide-y divide-border">
        {roster.map((name) => (
          <li key={name} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:px-5">
            <span className="flex-1 text-sm font-medium">{name}</span>
            <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={`Attendance for ${name}`}>
              {marks.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  role="radio"
                  aria-checked={attendance[name] === m.value}
                  onClick={() => setAttendance((a) => ({ ...a, [name]: m.value }))}
                  className={cn(
                    "rounded-full border border-border px-2.5 py-1 text-xs font-medium",
                    attendance[name] === m.value ? m.active : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <div className="flex" role="radiogroup" aria-label={`Performance rating for ${name}`}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={ratings[name] === n}
                  aria-label={`${n} star${n > 1 ? "s" : ""}`}
                  onClick={() => setRatings((r) => ({ ...r, [name]: n }))}
                  className="p-0.5"
                >
                  <Star className={cn("size-4", (ratings[name] ?? 0) >= n ? "fill-warning text-warning" : "text-border")} aria-hidden />
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
      <div className="border-t border-border p-4 sm:px-5">
        <label className="text-sm">
          <span className="text-muted-foreground">Feedback for Sara (shared privately with her)</span>
          <textarea
            rows={2}
            defaultValue="Great footwork at the net today. Next week let’s work on your backhand volley."
            className="mt-1 w-full resize-none rounded-lg border border-border bg-card p-3 text-sm"
          />
        </label>
      </div>
    </div>
  );
}
