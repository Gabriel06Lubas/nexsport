"use client";

import { Plus } from "lucide-react";
import { useRef } from "react";

import { ActionForm, Field, FormFooter, SelectField } from "@/components/forms/action-form";
import { Button } from "@/components/ui/button";

import { createSession } from "../actions/sessions";

type Option = { id: string; label: string };

// Quick action: schedule a session in a modal. Availability of the court,
// the coach and the equipment is checked by the server and the database when
// it's submitted; the dialog shows the reason if the slot isn't free.
export function NewSessionDialog({ facilities, sports, equipment, defaultDate, defaultSportId }: { facilities: Option[]; sports: Option[]; equipment: Option[]; defaultDate: string; defaultSportId?: string | null }) {
  const ref = useRef<HTMLDialogElement>(null);
  const disabled = facilities.length === 0;
  return (
    <>
      <Button type="button" size="sm" onClick={() => ref.current?.showModal()} disabled={disabled} title={disabled ? "Join a club roster first" : undefined}>
        <Plus aria-hidden /> New session
      </Button>
      <dialog
        ref={ref}
        aria-labelledby="new-session-title"
        className="m-auto max-h-[90dvh] w-[min(94vw,36rem)] overflow-y-auto rounded-2xl border border-border bg-card p-0 text-foreground backdrop:bg-black/40"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 id="new-session-title" className="text-base font-semibold">
            New session
          </h2>
          <button type="button" onClick={() => ref.current?.close()} className="rounded-full px-3 py-1 text-sm hover:bg-muted">
            Close
          </button>
        </div>
        <ActionForm action={createSession} label="New session" className="space-y-4 p-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SelectField
              name="kind"
              label="Type"
              options={[
                { value: "PRIVATE", label: "Private (1–2 students)" },
                { value: "GROUP", label: "Group class" },
                { value: "OPEN_MATCH", label: "Open match" },
              ]}
            />
            <Field name="title" label="Title" placeholder="Backhand clinic" maxLength={80} />
            <SelectField name="facilityId" label="Club · facility" options={facilities.map((f) => ({ value: f.id, label: f.label }))} className="sm:col-span-2" />
            <SelectField name="sportId" label="Sport" options={sports.map((s) => ({ value: s.id, label: s.label }))} defaultValue={defaultSportId ?? undefined} />
            <Field name="date" label="Date" type="date" defaultValue={defaultDate} min={defaultDate} />
            <Field name="startTime" label="From" type="time" step={900} defaultValue="18:00" hint="Club's local time" />
            <Field name="endTime" label="Until" type="time" step={900} defaultValue="19:00" />
            <Field name="maxParticipants" label="Max students" inputMode="numeric" hint="Blank: 1 for private, court capacity otherwise" />
            <Field name="price" label="Price per student" inputMode="decimal" placeholder="25" hint="Blank: free; open matches split the court price" />
            <Field name="minLevel" label="Level from" inputMode="decimal" placeholder="3.0" hint="Optional, 0–10" />
            <Field name="maxLevel" label="Level to" inputMode="decimal" placeholder="4.0" />
            <Field name="studentEmail" label="Add a student (email)" type="email" autoComplete="off" hint="Optional" className="sm:col-span-2" />
            <SelectField name="equipmentId" label="Reserve equipment" options={[{ id: "", label: "None" }, ...equipment].map((e) => ({ value: e.id, label: e.label }))} />
            <Field name="equipmentQuantity" label="Units" inputMode="numeric" />
          </div>
          <FormFooter submit="Schedule" pendingLabel="Checking availability…" />
        </ActionForm>
      </dialog>
    </>
  );
}
