import "server-only";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { sql } from "drizzle-orm";

import { db } from "./index";

// Development-only database check, so a missing server or unapplied
// migrations show up as one clear message instead of adapter stack traces.

export type DbHealth =
  | { ok: true }
  | { ok: false; problem: "unreachable"; detail: string }
  | { ok: false; problem: "not_migrated" }
  | { ok: false; problem: "migrations_pending"; pending: number };

function expectedMigrations(): number {
  try {
    const journal = JSON.parse(readFileSync(join(process.cwd(), "drizzle", "meta", "_journal.json"), "utf8"));
    return Array.isArray(journal.entries) ? journal.entries.length : 0;
  } catch {
    return 0;
  }
}

export async function checkDatabase(): Promise<DbHealth> {
  try {
    const check = db.execute(sql`SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS ready`);
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timed out after 3 s")), 3000));
    const ready = ((await Promise.race([check, timeout])).rows[0] as { ready: boolean }).ready;
    if (!ready) return { ok: false, problem: "not_migrated" };
    const { rows } = await db.execute(sql`SELECT count(*)::int AS applied FROM drizzle.__drizzle_migrations`);
    const pending = expectedMigrations() - (rows[0] as { applied: number }).applied;
    return pending > 0 ? { ok: false, problem: "migrations_pending", pending } : { ok: true };
  } catch (error) {
    const e = error as { cause?: { message?: string; code?: string }; message?: string; code?: string };
    return { ok: false, problem: "unreachable", detail: e.cause?.message ?? e.message ?? String(error) };
  }
}
