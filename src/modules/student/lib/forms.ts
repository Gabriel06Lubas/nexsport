import { z } from "zod";

import { idSchema } from "@/lib/validation";

// Student dashboard forms, validated on the server.

const checkbox = z.preprocess((value) => value === "on" || value === "true", z.boolean());

/** "3", "3.5", "3,5" → 3.5. Blank → null. 0.0–10.0, one decimal. */
export const levelSchema = z.preprocess(
  (v) => (v === undefined || (typeof v === "string" && v.trim() === "") ? null : v),
  z
    .string()
    .trim()
    .regex(/^\d{1,2}([.,]\d)?$/, "Use a level like 3 or 3.5")
    .transform((v) => Number(v.replace(",", ".")))
    .refine((n) => n >= 0 && n <= 10, "Use a level from 0 to 10")
    .nullable(),
);

export const preferencesSchema = z.object({
  matchAlerts: checkbox,
  bookingUpdates: checkbox,
  clubs: z
    .string()
    .default("")
    .transform((v) => [...new Set(v.split(",").filter(Boolean))])
    .pipe(z.array(idSchema).max(20, "Pick at most 20 clubs")),
});

export const cancelSchema = z.object({
  kind: z.enum(["session", "rental"]),
  id: idSchema,
});

export const joinSchema = z.object({ sessionId: idSchema });
