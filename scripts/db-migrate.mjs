// Applies pending migrations from ./drizzle, the same files and the same
// bookkeeping table (drizzle.__drizzle_migrations) as `drizzle-kit migrate`.
//
// Why not `drizzle-kit migrate` directly? drizzle-kit 0.31 exits with code 1
// but prints nothing when a migration fails, which hides the actual SQL
// error. Drizzle's programmatic migrator reports it.
import "dotenv/config";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set (add it to .env).");
  process.exit(1);
}

const db = drizzle(process.env.DATABASE_URL);
try {
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Migrations are up to date.");
} catch (error) {
  const cause = error?.cause;
  console.error(`Migration failed: ${cause?.message ?? error.message}`);
  if (cause?.detail) console.error(`Detail: ${cause.detail}`);
  if (cause?.hint) console.error(`Hint: ${cause.hint}`);
  if (error?.query) console.error(`Query:\n${error.query.trim()}`);
  // A database first created by the old Prisma migrations already has every
  // table but no Drizzle history, so the first migration collides with it.
  const { rows } = await db.$client
    .query(`SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS prisma`)
    .catch(() => ({ rows: [] }));
  if (rows[0]?.prisma) {
    console.error(
      "\nThis database was set up by the old Prisma migrations. For the local test database,\n" +
        "stop `npm run db:up`, delete the .local/pgdata folder, start it again and re-run this command.",
    );
  }
  process.exitCode = 1;
} finally {
  await db.$client.end();
}
