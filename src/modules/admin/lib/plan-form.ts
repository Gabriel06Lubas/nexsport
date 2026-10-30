import { z } from "zod";

import { empty, moneySchema, percentSchema } from "@/lib/money-input";
import { plainText } from "@/lib/validation";

// The plan editor's form. Money and percentages are parsed exactly by the
// shared schemas in src/lib/money-input.ts.

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

export { bpsToInput, centsToInput, formatBps, moneySchema, percentSchema } from "@/lib/money-input";
