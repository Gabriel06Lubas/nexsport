import { z } from "zod";

// Money and percentages typed by humans ("29", "29.90", "29,90", "3.5"),
// parsed exactly (no floating point) into integer minor units / basis points.

/** Treats a missing or blank field as "not given" (null), for nullable optional fields. */
export const empty = (value: unknown) => (value === undefined || (typeof value === "string" && value.trim() === "") ? null : value);

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
