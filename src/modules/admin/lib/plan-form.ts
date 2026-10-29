import { z } from "zod";

import { plainText } from "@/lib/validation";

// The plan editor's form. Money and percentages are typed by humans ("29",
// "29.90", "29,90", "3.5"), parsed exactly (no floating point), and stored as
// integer minor units / basis points.

const empty = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);

/** "29", "29.9", "29.90", "29,90" → 2990. At most 999,999.99. */
export const moneySchema = z
  .string()
  .trim()
  .regex(/^\d{1,6}([.,]\d{1,2})?$/, "Enter an amount like 29 or 29.90")
  .transform((value) => {
    const [whole = "0", fraction = ""] = value.replace(",", ".").split(".");
    return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  });

/** "3", "3.5", "12.25" (percent) → 300, 350, 1225 basis points. 0–100%. */
export const percentSchema = z
  .string()
  .trim()
  .regex(/^\d{1,3}([.,]\d{1,2})?$/, "Enter a percentage like 3 or 3.5")
  .transform((value) => {
    const [whole = "0", fraction = ""] = value.replace(",", ".").split(".");
    return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  })
  .refine((bps) => bps <= 10_000, "Use at most 100%");

/** Blank = unlimited (null); otherwise a whole number up to 1,000,000. */
const limitSchema = z.preprocess(
  empty,
  z
    .string()
    .trim()
    .regex(/^\d{1,7}$/, "Use a whole number, or leave blank for unlimited")
    .transform(Number)
    .refine((n) => n <= 1_000_000, "Use at most 1,000,000")
    .nullable(),
);

export const planFormSchema = z
  .object({
    tier: z.enum(["FREE_COACH", "PRO_COACH", "CLUB_BASIC", "CLUB_ENTERPRISE"]),
    name: plainText({ min: 2, max: 40, label: "plan name" }),
    monthlyPrice: moneySchema,
    platformFee: percentSchema,
    stripePriceId: z.preprocess(
      empty,
      z
        .string()
        .trim()
        .regex(/^price_[A-Za-z0-9]{8,64}$/, "Stripe Price IDs look like price_1Pq…")
        .nullable(),
    ),
    maxFacilities: limitSchema,
    maxStaff: limitSchema,
    maxAthletes: limitSchema,
    isActive: z.preprocess((value) => value === "on" || value === "true", z.boolean()),
    /** Optimistic concurrency: the updatedAt the form was rendered with. */
    expectedUpdatedAt: z.iso.datetime(),
  })
  .refine((plan) => !plan.isActive || plan.monthlyPrice === 0 || plan.stripePriceId, {
    path: ["stripePriceId"],
    message: "A paid plan needs a Stripe Price ID before it can be active",
  });

export type PlanForm = z.infer<typeof planFormSchema>;

export function formatBps(bps: number): string {
  return `${(bps / 100).toLocaleString("en", { maximumFractionDigits: 2 })}%`;
}

/** Cents → "29.90" for an input's default value. */
export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function bpsToInput(bps: number): string {
  return (bps / 100).toString();
}
