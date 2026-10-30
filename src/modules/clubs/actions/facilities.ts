"use server";

import { and, count, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { isUniqueViolation } from "@/db/errors";
import { equipment, equipmentMaintenance, facility, facilityPriceRule } from "@/db/schema";
import { formValues, invalid, type ActionState } from "@/lib/action-state";
import { idSchema } from "@/lib/validation";

import {
  equipmentSchema,
  facilitySchema,
  idOnly,
  maintenanceSchema,
  priceRuleSchema,
  resolveMaintenanceSchema,
} from "../lib/forms";
import { conflictMessage, guardClubWrite, LimitReached, lockClubAndGetLimits, revalidateClub } from "./shared";

// Facilities, dynamic pricing and equipment. Every write is scoped to the
// club from the guard: an id from another club simply matches no row.

const SECTION = "/facilities";

const ruleIdsSchema = z
  .string()
  .transform((value) => value.split(","))
  .pipe(z.array(idSchema).min(1).max(7));

export async function saveFacility(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const guard = await guardClubWrite(formData, "MANAGE_FACILITIES");
  if ("state" in guard) return guard.state;
  const { access } = guard;
  const values = formValues(formData);
  const parsed = facilitySchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error, values);
  const { facilityId, openTime, closeTime, standardRate, ...fields } = parsed.data;
  const row = { ...fields, openMinute: openTime, closeMinute: closeTime, hourlyRateAmount: standardRate };

  try {
    if (facilityId) {
      const updated = await db
        .update(facility)
        .set(row)
        .where(and(eq(facility.id, facilityId), eq(facility.clubId, access.club.id)))
        .returning({ id: facility.id });
      if (updated.length === 0) return { error: "That facility no longer exists." };
    } else {
      await db.transaction(async (tx) => {
        const limits = await lockClubAndGetLimits(tx, access.club.id);
        const [{ n = 0 } = {}] = await tx
          .select({ n: count() })
          .from(facility)
          .where(and(eq(facility.clubId, access.club.id), eq(facility.isActive, true)));
        if (limits.maxFacilities !== null && n >= limits.maxFacilities) {
          throw new LimitReached(`Your ${limits.name} plan includes ${limits.maxFacilities} active facilities. Deactivate one or upgrade.`);
        }
        await tx.insert(facility).values({ ...row, clubId: access.club.id });
      });
    }
  } catch (e) {
    if (e instanceof LimitReached) return { error: e.message, values };
    if (isUniqueViolation(e, "Facility_clubId_name_key")) return { error: "Check the highlighted fields.", fieldErrors: { name: "You already have a facility with that name" }, values };
    throw e;
  }
  revalidateClub(access, SECTION);
  return { ok: facilityId ? "Facility updated." : "Facility added." };
}

export async function setFacilityActive(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const guard = await guardClubWrite(formData, "MANAGE_FACILITIES");
  if ("state" in guard) return guard.state;
  const { access } = guard;
  const parsed = idOnly("facilityId").safeParse(formValues(formData));
  if (!parsed.success) return { error: "Unknown facility." };
  const facilityId = String(parsed.data.facilityId);
  const active = formData.get("active") === "true";

  try {
    await db.transaction(async (tx) => {
      if (active) {
        const limits = await lockClubAndGetLimits(tx, access.club.id);
        const [{ n = 0 } = {}] = await tx
          .select({ n: count() })
          .from(facility)
          .where(and(eq(facility.clubId, access.club.id), eq(facility.isActive, true)));
        if (limits.maxFacilities !== null && n >= limits.maxFacilities) {
          throw new LimitReached(`Your ${limits.name} plan includes ${limits.maxFacilities} active facilities.`);
        }
      }
      await tx.update(facility).set({ isActive: active }).where(and(eq(facility.id, facilityId), eq(facility.clubId, access.club.id)));
    });
  } catch (e) {
    if (e instanceof LimitReached) return { error: e.message };
    throw e;
  }
  revalidateClub(access, SECTION);
  return { ok: active ? "Facility reactivated." : "Facility deactivated. Existing bookings are kept." };
}

export async function addPriceRule(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const guard = await guardClubWrite(formData, "MANAGE_FACILITIES");
  if ("state" in guard) return guard.state;
  const { access } = guard;
  const values = formValues(formData);
  const parsed = priceRuleSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error, values);
  const { facilityId, days, startTime, endTime, tier, rate } = parsed.data;

  const [owned] = await db
    .select({ id: facility.id })
    .from(facility)
    .where(and(eq(facility.id, facilityId), eq(facility.clubId, access.club.id)));
  if (!owned) return { error: "That facility no longer exists." };

  try {
    // One row per weekday, all or nothing: an overlap on any day rejects the lot.
    await db.insert(facilityPriceRule).values(
      days.map((dayOfWeek) => ({ clubId: access.club.id, facilityId, dayOfWeek, startMinute: startTime, endMinute: endTime, tier, hourlyRateAmount: rate })),
    );
  } catch (e) {
    const message = conflictMessage(e);
    if (message) return { error: message, values };
    throw e;
  }
  revalidateClub(access, SECTION);
  return { ok: `${tier === "PEAK" ? "Peak" : "Off-peak"} rate added for ${days.length} ${days.length === 1 ? "day" : "days"}.` };
}

export async function deletePriceRule(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const guard = await guardClubWrite(formData, "MANAGE_FACILITIES");
  if ("state" in guard) return guard.state;
  const { access } = guard;
  // A window shown once for several days (Mon–Fri) is one row per day.
  const parsed = ruleIdsSchema.safeParse(formValues(formData).ruleIds);
  if (!parsed.success) return { error: "Unknown price rule." };
  await db
    .delete(facilityPriceRule)
    .where(and(inArray(facilityPriceRule.id, parsed.data), eq(facilityPriceRule.clubId, access.club.id)));
  revalidateClub(access, SECTION);
  return { ok: "Price rule removed." };
}

export async function saveEquipment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const guard = await guardClubWrite(formData, "MANAGE_EQUIPMENT");
  if ("state" in guard) return guard.state;
  const { access } = guard;
  const values = formValues(formData);
  const parsed = equipmentSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error, values);
  const { equipmentId, ...fields } = parsed.data;

  try {
    if (equipmentId) {
      const updated = await db
        .update(equipment)
        .set(fields)
        .where(and(eq(equipment.id, equipmentId), eq(equipment.clubId, access.club.id)))
        .returning({ id: equipment.id });
      if (updated.length === 0) return { error: "That item no longer exists." };
    } else {
      await db.insert(equipment).values({ ...fields, clubId: access.club.id });
    }
  } catch (e) {
    const message = conflictMessage(e);
    if (message) return { error: message, fieldErrors: { quantity: message }, values };
    throw e;
  }
  revalidateClub(access, SECTION);
  return { ok: equipmentId ? "Item updated." : "Item added." };
}

export async function startMaintenance(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const guard = await guardClubWrite(formData, "MANAGE_EQUIPMENT");
  if ("state" in guard) return guard.state;
  const { access } = guard;
  const values = formValues(formData);
  const parsed = maintenanceSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error, values);

  const [owned] = await db
    .select({ id: equipment.id })
    .from(equipment)
    .where(and(eq(equipment.id, parsed.data.equipmentId), eq(equipment.clubId, access.club.id)));
  if (!owned) return { error: "That item no longer exists." };

  try {
    await db.insert(equipmentMaintenance).values({ ...parsed.data, clubId: access.club.id, reportedById: access.user.id });
  } catch (e) {
    const message = conflictMessage(e);
    if (message) return { error: message, fieldErrors: { quantity: message }, values };
    throw e;
  }
  revalidateClub(access, SECTION);
  return { ok: "Logged for maintenance. Those units can't be booked until they're back." };
}

export async function resolveMaintenance(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const guard = await guardClubWrite(formData, "MANAGE_EQUIPMENT");
  if ("state" in guard) return guard.state;
  const { access } = guard;
  const values = formValues(formData);
  const parsed = resolveMaintenanceSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error, values);

  const updated = await db
    .update(equipmentMaintenance)
    .set({ resolvedAt: sql`now()`, resolvedById: access.user.id, resolutionNotes: parsed.data.resolutionNotes })
    .where(
      and(
        eq(equipmentMaintenance.id, parsed.data.maintenanceId),
        eq(equipmentMaintenance.clubId, access.club.id),
        isNull(equipmentMaintenance.resolvedAt),
      ),
    )
    .returning({ id: equipmentMaintenance.id });
  if (updated.length === 0) return { error: "Already back in service." };
  revalidateClub(access, SECTION);
  return { ok: "Back in service." };
}
