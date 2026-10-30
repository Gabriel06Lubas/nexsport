import { Wrench } from "lucide-react";
import type { Metadata } from "next";

import { EmptyState, formatDate, PageHeader, Panel, TableWrap, td, th } from "@/components/dashboard/ui";
import { ActionButton, ActionForm, CheckboxField, CheckboxGroup, Field, FormFooter, SelectField } from "@/components/forms/action-form";
import { Badge } from "@/components/ui/badge";
import { centsToInput } from "@/lib/money-input";
import { formatMoney } from "@/lib/utils";
import {
  addPriceRule,
  deletePriceRule,
  resolveMaintenance,
  saveEquipment,
  saveFacility,
  setFacilityActive,
  startMaintenance,
} from "@/modules/clubs/actions/facilities";
import { can, requireClubSection, type ClubAccess } from "@/modules/clubs/dal";
import { conditionLabels, dayLabels, facilityTypeLabels, formatDays, options, surfaceLabels } from "@/modules/clubs/lib/labels";
import { minuteToTime } from "@/modules/clubs/lib/zoned-time";
import { listEquipment, listFacilities, listMaintenance, type FacilityRow } from "@/modules/clubs/queries/facilities";

export const metadata: Metadata = { title: "Facilities & Courts" };

const typeOptions = options(facilityTypeLabels);
const surfaceOptions = [{ value: "", label: "Not specified" }, ...options(surfaceLabels)];
const conditionOptions = options(conditionLabels);
const dayOptions = dayLabels.map((label, i) => ({ value: String(i + 1), label }));
const tierOptions = [
  { value: "PEAK", label: "Peak" },
  { value: "OFF_PEAK", label: "Off-peak" },
];

export default async function FacilitiesPage({ params }: { params: Promise<{ clubSlug: string }> }) {
  const { clubSlug } = await params;
  const access = await requireClubSection(clubSlug, "facilities");
  const manageFacilities = can(access, "MANAGE_FACILITIES") && !access.readOnly;
  const manageEquipment = can(access, "MANAGE_EQUIPMENT") && !access.readOnly;
  const [facilities, equipment, maintenance] = await Promise.all([
    listFacilities(access.club.id),
    listEquipment(access.club.id),
    listMaintenance(access.club.id),
  ]);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Facilities & courts"
        description="Courts and pitches, their opening hours and dynamic pricing, and the equipment you lend out."
      />

      <section aria-labelledby="facilities-heading" className="space-y-4">
        <h2 id="facilities-heading" className="text-lg font-semibold">
          Courts & pitches
        </h2>
        {facilities.length === 0 && <EmptyState>No facilities yet. Add your first court or pitch below.</EmptyState>}
        {facilities.map((f) => (
          <FacilityCard key={f.id} facility={f} access={access} editable={manageFacilities} />
        ))}
        {manageFacilities && (
          <Panel title="Add a facility">
            <FacilityForm access={access} />
          </Panel>
        )}
      </section>

      <section aria-labelledby="equipment-heading" className="space-y-4">
        <h2 id="equipment-heading" className="text-lg font-semibold">
          Equipment inventory
        </h2>
        <Panel title={`${equipment.length} ${equipment.length === 1 ? "item" : "items"}`}>
          {equipment.length === 0 ? (
            <EmptyState>No equipment yet.</EmptyState>
          ) : (
            <TableWrap>
              <table className="w-full min-w-[760px]">
                <thead className="border-b border-border">
                  <tr>
                    <th scope="col" className={th}>Item</th>
                    <th scope="col" className={th}>Condition</th>
                    <th scope="col" className={th}>Total</th>
                    <th scope="col" className={th}>In repair</th>
                    <th scope="col" className={th}>Available</th>
                    {manageEquipment && <th scope="col" className={th}><span className="sr-only">Actions</span></th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {equipment.map((e) => {
                    const available = Math.max(0, e.quantity - e.inRepair);
                    const short = e.reservedUpcoming > available;
                    return (
                      <tr key={e.id} className={e.isActive ? undefined : "opacity-60"}>
                        <td className={td}>
                          <p className="font-medium">{e.name}</p>
                          <p className="text-xs text-muted-foreground">{[e.category, e.notes].filter(Boolean).join(" · ") || "—"}</p>
                        </td>
                        <td className={td}>
                          <Badge variant={e.condition === "NEEDS_REPAIR" ? "danger" : e.condition === "RETIRED" ? "outline" : e.condition === "FAIR" ? "warning" : "success"}>
                            {conditionLabels[e.condition]}
                          </Badge>
                        </td>
                        <td className={`${td} tabular-nums`}>{e.quantity}</td>
                        <td className={`${td} tabular-nums`}>{e.inRepair > 0 ? <span className="inline-flex items-center gap-1 text-warning"><Wrench className="size-3.5" aria-hidden />{e.inRepair}</span> : 0}</td>
                        <td className={`${td} tabular-nums`}>
                          {available}
                          {short && <span className="block text-xs text-danger">{e.reservedUpcoming} reserved for an upcoming session</span>}
                        </td>
                        {manageEquipment && (
                          <td className={`${td} text-right`}>
                            <details className="inline-block text-left">
                              <summary className="cursor-pointer whitespace-nowrap text-sm font-medium text-accent-text">Manage</summary>
                              <div className="mt-3 w-[min(80vw,22rem)] space-y-5">
                                <ActionForm action={startMaintenance} hidden={{ clubSlug: access.club.slug, equipmentId: e.id }} label={`Send ${e.name} to maintenance`} className="space-y-3">
                                  <p className="text-sm font-medium">Send units to maintenance</p>
                                  <Field name="quantity" label="Units" defaultValue="1" inputMode="numeric" />
                                  <Field name="reason" label="Reason" placeholder="Broken frame" maxLength={200} />
                                  <FormFooter submit="Log maintenance" />
                                </ActionForm>
                                <EquipmentForm access={access} item={e} />
                              </div>
                            </details>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Panel>
        {manageEquipment && (
          <Panel title="Add equipment">
            <EquipmentForm access={access} />
          </Panel>
        )}
      </section>

      <section aria-labelledby="maintenance-heading" className="space-y-4">
        <h2 id="maintenance-heading" className="text-lg font-semibold">
          Maintenance log
        </h2>
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Panel title={`Under maintenance (${maintenance.open.length})`}>
            {maintenance.open.length === 0 ? (
              <EmptyState>All equipment is in service.</EmptyState>
            ) : (
              <ul className="divide-y divide-border">
                {maintenance.open.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {m.quantity} × {m.equipmentName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {m.reason} · since {formatDate(m.startedAt, access.club.timezone)}
                        {m.reportedBy && <> · by {m.reportedBy}</>}
                      </p>
                    </div>
                    {manageEquipment && (
                      <ActionButton action={resolveMaintenance} hidden={{ clubSlug: access.club.slug, maintenanceId: m.id }} pendingLabel="Saving…">
                        Back in service
                      </ActionButton>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Recently repaired">
            {maintenance.recent.length === 0 ? (
              <EmptyState>Nothing repaired yet.</EmptyState>
            ) : (
              <ul className="divide-y divide-border">
                {maintenance.recent.map((m) => (
                  <li key={m.id} className="px-5 py-3">
                    <p className="text-sm font-medium">
                      {m.quantity} × {m.equipmentName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {m.reason} · {formatDate(m.startedAt, access.club.timezone)} → {m.resolvedAt && formatDate(m.resolvedAt, access.club.timezone)}
                      {m.resolutionNotes && <> · {m.resolutionNotes}</>}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </section>
    </div>
  );
}

/** Rules shown once per window: Mon–Fri 18:00–22:00 is five rows in the database. */
function groupRules(rules: FacilityRow["rules"]) {
  const groups = new Map<string, { ids: string[]; days: number[]; startMinute: number; endMinute: number; tier: "PEAK" | "OFF_PEAK"; rate: number }>();
  for (const r of rules) {
    const key = `${r.startMinute}-${r.endMinute}-${r.tier}-${r.hourlyRateAmount}`;
    const g = groups.get(key) ?? { ids: [], days: [], startMinute: r.startMinute, endMinute: r.endMinute, tier: r.tier, rate: r.hourlyRateAmount };
    g.ids.push(r.id);
    g.days.push(r.dayOfWeek);
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => a.startMinute - b.startMinute);
}

function FacilityCard({ facility: f, access, editable }: { facility: FacilityRow; access: ClubAccess; editable: boolean }) {
  const money = (n: number) => formatMoney(n, access.club.currency);
  const groups = groupRules(f.rules);
  return (
    <Panel
      title={f.name}
      action={
        <span className="flex flex-wrap items-center justify-end gap-2">
          <Badge variant={f.isActive ? "success" : "outline"}>{f.isActive ? "Active" : "Inactive"}</Badge>
          {editable && (
            <ActionButton
              action={setFacilityActive}
              hidden={{ clubSlug: access.club.slug, facilityId: f.id, active: String(!f.isActive) }}
              confirm={f.isActive ? `Deactivate ${f.name}? It can't be booked until reactivated.` : undefined}
            >
              {f.isActive ? "Deactivate" : "Reactivate"}
            </ActionButton>
          )}
        </span>
      }
    >
      <div className="grid grid-cols-1 gap-6 p-5 lg:grid-cols-2">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Type</dt>
          <dd>{facilityTypeLabels[f.type]}</dd>
          <dt className="text-muted-foreground">Surface</dt>
          <dd>{f.surface ? surfaceLabels[f.surface] : "—"}</dd>
          <dt className="text-muted-foreground">Setting</dt>
          <dd>
            {f.isIndoor ? "Indoor" : "Outdoor"}
            {f.hasLighting && " · floodlit"}
          </dd>
          <dt className="text-muted-foreground">Open</dt>
          <dd className="tabular-nums">
            {minuteToTime(f.openMinute)}–{minuteToTime(f.closeMinute)}
          </dd>
          <dt className="text-muted-foreground">Standard rate</dt>
          <dd className="tabular-nums">{f.hourlyRateAmount === null ? "Not set" : `${money(f.hourlyRateAmount)}/h`}</dd>
          <dt className="text-muted-foreground">Upcoming bookings</dt>
          <dd className="tabular-nums">{f.upcomingBookings}</dd>
        </dl>

        <div className="min-w-0 space-y-3">
          <h3 className="text-sm font-semibold">Dynamic pricing</h3>
          {groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">Every hour is charged at the standard rate.</p>
          ) : (
            <ul className="space-y-2" aria-label={`Price rules for ${f.name}`}>
              {groups.map((g) => (
                <li key={g.ids.join(",")} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border px-3 py-2 text-sm">
                  <span className="min-w-0">
                    <Badge variant={g.tier === "PEAK" ? "lime" : "neutral"}>{g.tier === "PEAK" ? "Peak" : "Off-peak"}</Badge>{" "}
                    <span className="tabular-nums">
                      {formatDays(g.days)} · {minuteToTime(g.startMinute)}–{minuteToTime(g.endMinute)} · {money(g.rate)}/h
                    </span>
                  </span>
                  {editable && (
                    <ActionButton action={deletePriceRule} hidden={{ clubSlug: access.club.slug, ruleIds: g.ids.join(",") }} variant="ghost">
                      Remove
                    </ActionButton>
                  )}
                </li>
              ))}
            </ul>
          )}
          {editable && (
            <details>
              <summary className="cursor-pointer text-sm font-medium text-accent-text">Add a price window</summary>
              <ActionForm action={addPriceRule} hidden={{ clubSlug: access.club.slug, facilityId: f.id }} label={`Add a price window to ${f.name}`} className="mt-3 space-y-3">
                <CheckboxGroup name="days" legend="Days" options={dayOptions} />
                <div className="grid grid-cols-2 gap-3">
                  <Field name="startTime" label="From" type="time" step={900} defaultValue="18:00" />
                  <Field name="endTime" label="Until" type="time" step={900} defaultValue="22:00" />
                  <SelectField name="tier" label="Band" options={tierOptions} />
                  <Field name="rate" label={`Rate per hour (${access.club.currency.toUpperCase()})`} inputMode="decimal" placeholder="32" />
                </div>
                <FormFooter submit="Add window" />
              </ActionForm>
            </details>
          )}
        </div>
      </div>
      {editable && (
        <details className="border-t border-border px-5 py-3">
          <summary className="cursor-pointer text-sm font-medium text-accent-text">Edit {f.name}</summary>
          <FacilityForm access={access} facility={f} />
        </details>
      )}
    </Panel>
  );
}

function FacilityForm({ access, facility: f }: { access: ClubAccess; facility?: FacilityRow }) {
  return (
    <ActionForm
      action={saveFacility}
      hidden={{ clubSlug: access.club.slug, ...(f ? { facilityId: f.id } : {}) }}
      label={f ? `Edit ${f.name}` : "Add a facility"}
      className="space-y-4 p-5"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field name="name" label="Name" defaultValue={f?.name} placeholder="Padel Glass Court 1" maxLength={60} />
        <SelectField name="type" label="Type" options={typeOptions} defaultValue={f?.type ?? "PADEL_COURT"} />
        <SelectField name="surface" label="Surface" options={surfaceOptions} defaultValue={f?.surface ?? ""} />
        <Field name="capacity" label="Capacity (people)" defaultValue={f?.capacity?.toString() ?? ""} inputMode="numeric" hint="Optional" />
        <Field
          name="standardRate"
          label={`Standard rate per hour (${access.club.currency.toUpperCase()})`}
          defaultValue={f?.hourlyRateAmount != null ? centsToInput(f.hourlyRateAmount) : ""}
          inputMode="decimal"
          hint="Charged outside peak / off-peak windows"
        />
        <div className="grid grid-cols-2 gap-3">
          <Field name="openTime" label="Opens" type="time" step={900} defaultValue={minuteToTime(f?.openMinute ?? 420)} />
          <Field name="closeTime" label="Closes" type="time" step={900} defaultValue={minuteToTime(f?.closeMinute ?? 1380)} />
        </div>
        <CheckboxField name="isIndoor" label="Indoor" defaultChecked={f?.isIndoor} />
        <CheckboxField name="hasLighting" label="Floodlights" defaultChecked={f?.hasLighting} />
      </div>
      <FormFooter submit={f ? "Save changes" : "Add facility"} />
    </ActionForm>
  );
}

type EquipmentItem = Awaited<ReturnType<typeof listEquipment>>[number];

function EquipmentForm({ access, item }: { access: ClubAccess; item?: EquipmentItem }) {
  return (
    <ActionForm
      action={saveEquipment}
      hidden={{ clubSlug: access.club.slug, ...(item ? { equipmentId: item.id } : {}) }}
      label={item ? `Edit ${item.name}` : "Add equipment"}
      className={item ? "space-y-3" : "space-y-4 p-5"}
    >
      {item && <p className="text-sm font-medium">Edit item</p>}
      <div className={item ? "space-y-3" : "grid grid-cols-1 gap-4 sm:grid-cols-2"}>
        <Field name="name" label="Name" defaultValue={item?.name} placeholder="Rental padel rackets" maxLength={60} />
        <Field name="category" label="Category" defaultValue={item?.category ?? ""} placeholder="Rackets" maxLength={40} />
        <Field name="quantity" label="Units owned" defaultValue={item ? String(item.quantity) : "1"} inputMode="numeric" />
        <SelectField name="condition" label="Condition" options={conditionOptions} defaultValue={item?.condition ?? "GOOD"} />
        <Field name="notes" label="Notes" defaultValue={item?.notes ?? ""} maxLength={300} className={item ? undefined : "sm:col-span-2"} />
      </div>
      <FormFooter submit={item ? "Save item" : "Add item"} />
    </ActionForm>
  );
}
