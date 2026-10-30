import { z } from "zod";

import { emailSchema } from "@/modules/auth/lib/email-code-policy";
import { empty, moneySchema, percentSchema } from "@/lib/money-input";
import { idSchema, plainText } from "@/lib/validation";
import {
  employmentType,
  equipmentCondition,
  facilityType,
  membershipPlanKind,
  priceTier,
  surfaceType,
} from "@/db/schema/enums";

import { allClubPermissions, clubSlugPattern, reservedClubSlugs } from "./permissions";
import { isValidTimeZone, timeToMinute } from "./zoned-time";

// Every club dashboard form, validated on the server. Values arrive as
// strings from FormData; nothing here is trusted from the client, and
// nothing is ever concatenated into SQL (Drizzle binds every value).

const optional = <T extends z.ZodType>(schema: T) => z.preprocess(empty, schema.nullable());
const checkbox = z.preprocess((value) => value === "on" || value === "true", z.boolean());
const intIn = (min: number, max: number, label: string) =>
  z
    .string()
    .trim()
    .regex(/^\d{1,7}$/, `Enter ${label} as a whole number`)
    .transform(Number)
    .refine((n) => n >= min && n <= max, `Use a number from ${min} to ${max}`);
/** "18:00" on the 15-minute grid → minutes after midnight. */
const timeOnGrid = (label: string) =>
  z
    .string()
    .transform((value, ctx) => {
      const minute = timeToMinute(value);
      if (minute === null || minute % 15 !== 0) {
        ctx.addIssue({ code: "custom", message: `Enter ${label} as HH:MM in 15-minute steps` });
        return z.NEVER;
      }
      return minute;
    });
const dateKey = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Pick a date");
/** Comma-joined checkbox group (see formValues) → distinct values. */
const list = <T extends string>(allowed: readonly T[]) =>
  z
    .string()
    .default("")
    .transform((value) => [...new Set(value.split(",").filter(Boolean))])
    .pipe(z.array(z.enum(allowed as [T, ...T[]])));

export const clubSlugSchema = z
  .string()
  .regex(clubSlugPattern, "Use lowercase letters, numbers and single hyphens")
  .min(3, "Use at least 3 characters")
  .max(48, "Use at most 48 characters")
  .refine((slug) => !reservedClubSlugs.has(slug), "That address is reserved");

// ---- Club ---------------------------------------------------------------------

export const currencies = ["eur", "usd", "gbp", "chf", "sek", "nok", "dkk", "pln", "aud", "cad"] as const;

export const createClubSchema = z.object({
  name: plainText({ min: 2, max: 80, label: "club name" }),
  slug: clubSlugSchema,
  city: optional(plainText({ min: 1, max: 80, label: "city" })),
  country: z.string().regex(/^[A-Z]{2}$/, "Pick a country"),
  timezone: z.string().max(64).refine(isValidTimeZone, "Pick a time zone"),
  currency: z.enum(currencies, { error: "Pick a currency" }),
});

// ---- Facilities & pricing -----------------------------------------------------

export const facilitySchema = z
  .object({
    facilityId: optional(idSchema),
    name: plainText({ min: 2, max: 60, label: "facility name" }),
    type: z.enum(facilityType.enumValues, { error: "Pick a type" }),
    surface: optional(z.enum(surfaceType.enumValues)),
    isIndoor: checkbox,
    hasLighting: checkbox,
    capacity: optional(intIn(1, 500, "capacity")),
    standardRate: optional(moneySchema),
    openTime: timeOnGrid("the opening time"),
    closeTime: timeOnGrid("the closing time"),
  })
  .refine((f) => f.openTime < f.closeTime, { path: ["closeTime"], message: "Closing must be after opening" });

export const priceRuleSchema = z
  .object({
    facilityId: idSchema,
    days: z
      .string()
      .default("")
      .transform((value) => [...new Set(value.split(",").filter(Boolean))])
      .pipe(z.array(z.enum(["1", "2", "3", "4", "5", "6", "7"])).min(1, "Pick at least one day"))
      .transform((days) => days.map(Number)),
    startTime: timeOnGrid("the start time"),
    endTime: timeOnGrid("the end time"),
    tier: z.enum(priceTier.enumValues),
    rate: moneySchema,
  })
  .refine((r) => r.startTime < r.endTime, { path: ["endTime"], message: "End must be after start" });

export const idOnly = (key: string) => z.object({ [key]: idSchema });

// ---- Equipment ----------------------------------------------------------------

export const equipmentSchema = z.object({
  equipmentId: optional(idSchema),
  name: plainText({ min: 2, max: 60, label: "item name" }),
  category: optional(plainText({ min: 1, max: 40, label: "category" })),
  quantity: intIn(0, 100_000, "the quantity"),
  condition: z.enum(equipmentCondition.enumValues),
  notes: optional(plainText({ min: 1, max: 300, label: "note" })),
});

export const maintenanceSchema = z.object({
  equipmentId: idSchema,
  quantity: intIn(1, 100_000, "the number of units"),
  reason: plainText({ min: 3, max: 200, label: "reason" }),
});

export const resolveMaintenanceSchema = z.object({
  maintenanceId: idSchema,
  resolutionNotes: optional(plainText({ min: 1, max: 300, label: "note" })),
});

// ---- Bookings -----------------------------------------------------------------

export const bookingSchema = z
  .object({
    facilityId: idSchema,
    date: dateKey,
    startTime: timeOnGrid("the start time"),
    endTime: timeOnGrid("the end time"),
    customerEmail: optional(emailSchema),
    customerName: optional(plainText({ min: 2, max: 80, label: "customer name" })),
    paymentMethod: z.enum(["ON_SITE", "COMPLIMENTARY"]),
    paidNow: checkbox,
    notes: optional(plainText({ min: 1, max: 300, label: "note" })),
  })
  .refine((b) => b.startTime < b.endTime, { path: ["endTime"], message: "End must be after start" })
  .refine((b) => b.endTime - b.startTime >= 30 && b.endTime - b.startTime <= 8 * 60, {
    path: ["endTime"],
    message: "Bookings last from 30 minutes to 8 hours",
  })
  .refine((b) => b.customerEmail || b.customerName, { path: ["customerName"], message: "Enter a customer email or name" });

export const cancelBookingSchema = z.object({
  bookingId: idSchema,
  reason: plainText({ min: 3, max: 200, label: "reason" }),
});

// ---- Memberships --------------------------------------------------------------

export const membershipPlanSchema = z
  .object({
    planId: optional(idSchema),
    name: plainText({ min: 2, max: 60, label: "plan name" }),
    description: optional(plainText({ min: 1, max: 300, label: "description" })),
    kind: z.enum(membershipPlanKind.enumValues),
    price: moneySchema,
    durationDays: intIn(1, 3660, "the validity"),
    creditCount: optional(intIn(1, 1000, "the number of sessions")),
  })
  .refine((p) => (p.kind === "CREDITS") === (p.creditCount !== null), {
    path: ["creditCount"],
    message: "Session passes need a number of sessions; unlimited plans don't",
  });

export const sellPassSchema = z.object({
  planId: idSchema,
  email: emailSchema,
  startDate: optional(dateKey),
  paymentMethod: z.enum(["ON_SITE", "COMPLIMENTARY"]),
});

// ---- Staff --------------------------------------------------------------------

const payFields = {
  employmentType: z.enum(employmentType.enumValues, { error: "Pick employee or freelance" }),
  hourlyWage: optional(moneySchema),
  commission: optional(percentSchema),
};
const payRule = <T extends { employmentType: string; hourlyWage: number | null; commission: number | null }>(s: T) =>
  s.employmentType === "EMPLOYEE" ? s.hourlyWage !== null : s.commission !== null;
const payMessage = { path: ["employmentType"], message: "Employees need an hourly wage; freelancers a commission" };

/** Adding someone without pay terms (members who can't see payroll). */
export const addMemberSchema = z.object({
  email: emailSchema,
  role: z.enum(["STAFF", "COACH"]),
  title: optional(plainText({ min: 2, max: 60, label: "job title" })),
});

export const addStaffSchema = addMemberSchema.extend(payFields).refine(payRule, payMessage);

export const updatePaySchema = z
  .object({
    memberId: idSchema,
    title: optional(plainText({ min: 2, max: 60, label: "job title" })),
    ...payFields,
  })
  .refine(payRule, payMessage);

export const permissionsSchema = z.object({
  memberId: idSchema,
  permissions: list(allClubPermissions),
});

export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
