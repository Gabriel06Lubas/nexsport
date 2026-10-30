import "server-only";

import type { SQL } from "drizzle-orm";

import { db } from "@/db";

// Read models for the club dashboard. Every query takes the club id from
// requireClubAccess() and filters on it; values from the URL are bound
// parameters (Drizzle's sql`` turns each ${value} into $n), never SQL text.

export async function rows<T>(query: SQL): Promise<T[]> {
  return (await db.execute(query)).rows as T[];
}

export type ClubRef = { id: string; timezone: string; currency: string };
