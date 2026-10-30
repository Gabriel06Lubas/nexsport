import { z } from "zod";

import { attendanceStatus, sessionKind } from "@/db/schema/enums";
import { empty, moneySchema } from "@/lib/money-input";
import { idSchema, plainText } from "@/lib/validation";
import { emailSchema } from "@/modules/auth/lib/email-code-policy";
import { clubSlugPattern } from "@/modules/clubs/lib/permissions";
import { isValidTimeZone, timeToMinute } from "@/modules/clubs/lib/zoned-time";
import { levelSchema } from "@/modules/student/lib/forms";

// Coach dashboard forms, validated on the server. Same rules as the club
// forms: exact money, times on a 15-minute grid, ids as [a-z0-9], free text
// through plainText().

const optional = <T extends z.ZodType>(schema: T) => z.preprocess(empty, schema.nullable());
const checkbox = z.preprocess((value) => value === "on" || value === "true", z.boolean());
const intIn = (min: number, max: number, label: string) =>
  z
    .string()
    .trim()
    .regex(/^\d{1,6}$/, `Enter ${label} as a whole number`)
    .transform(Number)
    .refine((n) => n >= min && n <= max, `Use a number from ${min} to ${max}`);
const timeOnGrid = (label: string) =>
  z.string().transform((value, ctx) => {
    const minute = timeToMinute(value);
    if (minute === null || minute % 15 !== 0) {
      ctx.addIssue({ code: "custom", message: `Enter ${label} as HH:MM in 15-minute steps` });
      return z.NEVER;
    }
    return minute;
  });
const dateKey = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Pick a date");

export const reservedCoachSlugs = new Set(["new", "admin", "dashboard", "login", "settings", "api", "book"]);

export const sessionSchema = z
  .object({
    facilityId: idSchema,
    sportId: idSchema,
    kind: z.enum(sessionKind.enumValues),
    title: plainText({ min: 2, max: 80, label: "title" }),
    date: dateKey,
    startTime: timeOnGrid("the start time"),
    endTime: timeOnGrid("the end time"),
    maxParticipants: optional(intIn(1, 100, "the group size")),
    price: optional(moneySchema),
    studentEmail: optional(emailSchema),
    equipmentId: optional(idSchema),
    equipmentQuantity: optional(intIn(1, 1000, "the quantity")),
    minLevel: levelSchema,
    maxLevel: levelSchema,
  })
  .refine((s) => s.minLevel === null || s.maxLevel === null || s.minLevel <= s.maxLevel, { path: ["maxLevel"], message: "Use a range from low to high" })
  .refine((s) => s.startTime < s.endTime, { path: ["endTime"], message: "End must be after start" })
  .refine((s) => s.endTime - s.startTime >= 30 && s.endTime - s.startTime <= 4 * 60, { path: ["endTime"], message: "Sessions last from 30 minutes to 4 hours" })
  .refine((s) => s.kind !== "PRIVATE" || s.maxParticipants === null || s.maxParticipants <= 2, {
    path: ["maxParticipants"],
    message: "A private session has 1 or 2 students",
  })
  .refine((s) => (s.equipmentId === null) === (s.equipmentQuantity === null), { path: ["equipmentQuantity"], message: "Pick equipment and a quantity together" });

export const cancelSessionSchema = z.object({
  sessionId: idSchema,
  reason: plainText({ min: 3, max: 200, label: "reason" }),
});

export const addParticipantSchema = z.object({ sessionId: idSchema, email: emailSchema });

export const attendanceSchema = z.object({
  participantId: idSchema,
  status: z.enum(attendanceStatus.enumValues),
});

export const creditSchema = z.object({
  passId: idSchema,
  direction: z.enum(["deduct", "restore"]),
  reason: optional(plainText({ min: 3, max: 120, label: "reason" })),
});

export const profileSchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(clubSlugPattern, "Use lowercase letters, numbers and single hyphens")
    .min(3, "Use at least 3 characters")
    .max(48, "Use at most 48 characters")
    .refine((slug) => !reservedCoachSlugs.has(slug), "That link is reserved"),
  headline: optional(plainText({ min: 2, max: 80, label: "headline" })),
  bio: optional(plainText({ min: 2, max: 600, label: "bio" })),
  timezone: z.string().max(64).refine(isValidTimeZone, "Pick a time zone"),
  sportId: optional(idSchema),
  privateRate: optional(moneySchema),
  groupRate: optional(moneySchema),
  sessionMinutes: z.enum(["30", "45", "60", "75", "90", "120"]).transform(Number),
  minNoticeHours: intIn(0, 168, "the notice"),
  maxAdvanceDays: intIn(1, 90, "the booking horizon"),
  bookingEnabled: checkbox,
});

export const availabilitySchema = z
  .object({
    clubId: idSchema,
    facilityId: optional(idSchema),
    days: z
      .string()
      .default("")
      .transform((value) => [...new Set(value.split(",").filter(Boolean))])
      .pipe(z.array(z.enum(["1", "2", "3", "4", "5", "6", "7"])).min(1, "Pick at least one day"))
      .transform((days) => days.map(Number)),
    startTime: timeOnGrid("the start time"),
    endTime: timeOnGrid("the end time"),
  })
  .refine((w) => w.startTime < w.endTime, { path: ["endTime"], message: "End must be after start" });

export const bookSlotSchema = z.object({
  coachSlug: z.string().regex(clubSlugPattern).max(48),
  clubId: idSchema,
  startsAt: z.iso.datetime(),
});
