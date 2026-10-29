import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

// One connection pool per server process. In dev, Next.js hot-reloads
// modules, so the pool is cached on globalThis to avoid exhausting
// connections. pg connects lazily: nothing happens until the first query,
// so importing this module needs no DATABASE_URL (e.g. during `next build`).
const globalForDb = globalThis as unknown as { pool?: Pool };

function createPool() {
  const created = new Pool({ connectionString: process.env.DATABASE_URL });
  // Idle connections can be dropped by the server at any time (Postgres
  // restarted, `npm run db:up` stopped, a failover). Without a listener that
  // "error" event is an uncaught exception that crashes the process; with
  // one, the pool simply opens a new connection for the next query.
  created.on("error", (error) => console.error(`[db] idle connection lost, will reconnect: ${error.message}`));
  return created;
}

const pool = globalForDb.pool ?? createPool();
if (process.env.NODE_ENV !== "production") globalForDb.pool = pool;

export const db = drizzle({ client: pool, schema });

export type Db = typeof db;
/** A transaction handle, for helpers that run inside `db.transaction(...)`. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
