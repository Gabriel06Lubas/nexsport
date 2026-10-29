// npm run db:up: a throwaway local PostgreSQL for development and testing.
//
// Uses the `embedded-postgres` dev dependency (real PostgreSQL binaries
// downloaded by npm), so there is nothing to install system-wide. Data lives
// in .local/pgdata (git-ignored) and persists between runs. Press Ctrl+C to
// stop the server.
//
// Connection settings come from DATABASE_URL in .env when it points at this
// machine, so the server and the app always agree on port, user and database.
import "dotenv/config";

import { existsSync, readdirSync, rmSync } from "node:fs";
import net from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import EmbeddedPostgres from "embedded-postgres";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const databaseDir = join(root, ".local/pgdata");

const DEFAULT_URL = "postgresql://postgres:postgres@localhost:5432/nexport";
const settings = (() => {
  const url = new URL(process.env.DATABASE_URL || DEFAULT_URL);
  const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  if (!local) {
    console.error(`DATABASE_URL points at ${url.hostname}, not this machine; db:up only runs a local server.`);
    console.error(`Set DATABASE_URL="${DEFAULT_URL}" in .env to use it.`);
    process.exit(1);
  }
  return {
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username || "postgres"),
    password: decodeURIComponent(url.password || "postgres"),
    database: decodeURIComponent(url.pathname.slice(1) || "nexport"),
  };
})();

/** Resolves true when something is already listening on the port. */
function portInUse(port) {
  return new Promise((done) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    socket.once("connect", () => (socket.destroy(), done(true)));
    socket.once("error", () => done(false));
  });
}

if (await portInUse(settings.port)) {
  console.error(`Port ${settings.port} is already in use.`);
  console.error("Either another PostgreSQL is running (stop it, or an earlier `npm run db:up` that's still open),");
  console.error(`or pick another port: change it in DATABASE_URL in .env (e.g. localhost:5433) and run db:up again.`);
  process.exit(1);
}

// A first run that was interrupted leaves a data folder without PG_VERSION,
// which initdb refuses to reuse. Such a folder holds no database yet.
if (existsSync(databaseDir) && !existsSync(join(databaseDir, "PG_VERSION")) && readdirSync(databaseDir).length > 0) {
  console.log("Removing an incomplete .local/pgdata left by an interrupted first run.");
  rmSync(databaseDir, { recursive: true, force: true });
}

const pg = new EmbeddedPostgres({
  databaseDir,
  port: settings.port,
  user: settings.user,
  password: settings.password,
  persistent: true,
  // UTF-8 with PostgreSQL's built-in C.UTF-8 locale: names like "María"
  // are stored correctly and upper()/lower()/ILIKE follow Unicode rules,
  // identically on every OS. Without these flags initdb picks SQL_ASCII.
  initdbFlags: ["--encoding=UTF8", "--locale=C", "--locale-provider=builtin", "--builtin-locale=C.UTF-8"],
  // PostgreSQL refuses to run as root (common in Docker and dev containers);
  // in that case the library runs it as a dedicated `postgres` user.
  createPostgresUser: process.getuid?.() === 0,
  onLog: () => {}, // initdb/server chatter; errors still go to onError
  onError: (message) => process.stderr.write(`${String(message).trim()}\n`),
});

try {
  if (!existsSync(join(databaseDir, "PG_VERSION"))) {
    console.log("First run: creating the local database cluster in .local/pgdata …");
    await pg.initialise();
  }
  await pg.start();
  try {
    await pg.createDatabase(settings.database);
  } catch (error) {
    if (!/already exists/i.test(String(error))) throw error;
  }
} catch (error) {
  console.error(`\nCould not start the local PostgreSQL: ${error instanceof Error ? error.message : error}`);
  await pg.stop().catch(() => {});
  process.exit(1);
}

const url = `postgresql://${settings.user}:***@localhost:${settings.port}/${settings.database}`;
console.log(`\nPostgreSQL is running at ${url}`);
console.log("Leave this running. In another terminal: npm run db:migrate (then npm run dev or npm run db:studio).");
console.log("Press Ctrl+C to stop.");

// Stop PostgreSQL cleanly on Ctrl+C / termination, so it doesn't keep
// holding the port (embedded-postgres also hooks process exit).
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    console.log("\nStopping PostgreSQL …");
    await pg.stop().catch(() => {});
    process.exit(0);
  });
}
