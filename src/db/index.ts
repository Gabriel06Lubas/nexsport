import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

// One connection pool per server process. In dev, Next.js hot-reloads
// modules, so the pool is cached on globalThis to avoid exhausting
// connections. pg connects lazily: nothing happens until the first query,
// so importing this module needs no DATABASE_URL (e.g. during `next build`).
const globalForDb = globalThis as unknown as { pool?: Pool };

const pool = globalForDb.pool ?? new Pool({ connectionString: process.env.DATABASE_URL });
if (process.env.NODE_ENV !== "production") globalForDb.pool = pool;

export const db = drizzle({ client: pool, schema });

export type Db = typeof db;
/** A transaction handle, for helpers that run inside `db.transaction(...)`. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
