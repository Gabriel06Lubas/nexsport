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

/**
 * The error's text. Connection errors can have an empty message: when a host
 * name like "localhost" resolves to both ::1 and 127.0.0.1 (macOS), Node tries
 * both and throws an AggregateError whose own message is "".
 */
function describe(error) {
  if (!error) return "unknown error";
  if (error.message) return error.message;
  if (Array.isArray(error.errors) && error.errors.length) return error.errors.map(describe).join("; ");
  return error.code ?? String(error);
}

function codeOf(error) {
  return error?.code ?? error?.errors?.find((e) => e?.code)?.code;
}

const url = new URL(process.env.DATABASE_URL);
const where = `${url.hostname}:${url.port || 5432}`;
const connectionHints = {
  ECONNREFUSED: `Nothing is accepting connections on ${where}. Is the database running?\n` +
    "Start the local one with `npm run db:up` in another terminal (and leave it running),\n" +
    "and check that DATABASE_URL in .env uses the same port it prints.",
  ENOTFOUND: `The database host "${url.hostname}" doesn't resolve. Check DATABASE_URL in .env.`,
  ETIMEDOUT: `Connecting to ${where} timed out. Check DATABASE_URL and that the server is reachable.`,
  "28P01": "Postgres rejected the user name or password in DATABASE_URL.",
  "3D000": `The database "${url.pathname.slice(1)}" doesn't exist on ${where}. \`npm run db:up\` creates it for the local server.`,
};

const db = drizzle(process.env.DATABASE_URL);
try {
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Migrations are up to date.");
} catch (error) {
  const cause = error?.cause ?? error;
  const hint = connectionHints[codeOf(cause)];
  if (hint) {
    // Never reached the database: the SQL below isn't the problem.
    console.error(`Could not connect to the database (${describe(cause)}).\n\n${hint}`);
    process.exitCode = 1;
    await db.$client.end().catch(() => {});
    process.exit();
  }
  console.error(`Migration failed: ${describe(cause)}`);
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
