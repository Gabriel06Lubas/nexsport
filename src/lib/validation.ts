import { z } from "zod";

// Shared rules for free-text form fields. Database queries are parameterised
// (Drizzle) and React escapes all output, so these rules are about keeping
// stored text clean and unspoofable, not about escaping:
//   * C0/C1 control characters, including NUL (Postgres rejects it, which
//     would turn a form post into a server error) and CR/LF;
//   * Unicode bidi overrides and isolates (U+202A-U+202E, U+2066-U+2069),
//     which can make a name render as something else ("Trojan Source");
//   * zero-width and other invisible characters (U+200B-U+200F, U+2060, U+FEFF).
// Text is NFC-normalised so the same visible name is stored the same way.

const forbidden = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/;

export function plainText({ min, max, label }: { min: number; max: number; label: string }) {
  return z
    .string({ error: `Enter a ${label}` })
    .max(max * 4, `Use at most ${max} characters`)
    .transform((value) => value.normalize("NFC").replace(/\s+/g, " ").trim())
    .pipe(
      z
        .string()
        .min(min, `Use at least ${min} characters`)
        .max(max, `Use at most ${max} characters`)
        .refine((value) => !forbidden.test(value), `The ${label} contains characters that aren't allowed`),
    );
}

/** Ids we generate (cuid2): lowercase letters and digits only. */
export const idSchema = z.string().regex(/^[a-z0-9]{1,64}$/, "Invalid id");
