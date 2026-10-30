import { z } from "zod";

// Parsing of list URLs (admin and club dashboards) (?q=&type=&page=). Search params are user input:
// they are validated, clamped and only ever used as bound query parameters.

export const PAGE_SIZE = 20;

const first = (value: unknown) => (Array.isArray(value) ? value[0] : value);

export const listParamsSchema = z.object({
  q: z.preprocess(
    first,
    z
      .string()
      .max(200)
      .transform((value) => value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 100))
      .catch(""),
  ),
  page: z.preprocess(first, z.coerce.number().int().min(1).max(10_000).catch(1)),
});

export function parseListParams(params: Record<string, string | string[] | undefined>) {
  return listParamsSchema.parse({ q: params.q ?? "", page: params.page ?? 1 });
}

/** One of `allowed`, or the fallback. For ?type=, ?status= and the like. */
export function pickParam<const T extends readonly string[]>(value: unknown, allowed: T, fallback: T[number]): T[number] {
  const v = first(value);
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? v : fallback;
}

/**
 * Escapes LIKE/ILIKE wildcards so a search for "50%" or "a_b" matches those
 * characters literally (use with `ESCAPE '\'`). This is about correct
 * matching, not injection: the pattern is always a bound parameter.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / PAGE_SIZE));
}
