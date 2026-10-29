// Postgres error helpers. Drizzle wraps driver errors (DrizzleQueryError),
// so the SQLSTATE and constraint name may sit on the error or on `.cause`.

type PgError = { code?: string; constraint?: string };

function pgError(error: unknown): PgError | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const e = error as PgError & { cause?: unknown };
  if (typeof e.code === "string") return e;
  return e.cause ? pgError(e.cause) : undefined;
}

/** 23505: a unique index or constraint rejected the write. */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const e = pgError(error);
  return e?.code === "23505" && (!constraint || e.constraint === constraint);
}

/**
 * 23P01: a booking guard rejected the write (facility overlap, equipment
 * over-allocation or a full session). See drizzle/0001_booking_guards.sql.
 */
export function isBookingConflict(error: unknown): string | null {
  const e = pgError(error);
  return e?.code === "23P01" ? (e.constraint ?? "unknown") : null;
}
