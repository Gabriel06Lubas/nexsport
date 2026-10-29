import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundled = join(
  root,
  ".local/embedded-pg/node_modules/embedded-postgres/dist/index.js",
);
const { default: EmbeddedPostgres } = await import(
  existsSync(bundled) ? pathToFileURL(bundled).href : "embedded-postgres"
);

const databaseDir = join(root, ".local/pgdata");
const pg = new EmbeddedPostgres({
  databaseDir,
  user: "postgres",
  password: "postgres",
  port: 5432,
  persistent: true,
  onLog: (message) => process.stdout.write(String(message)),
  onError: (message) => process.stderr.write(String(message)),
});

if (!existsSync(join(databaseDir, "PG_VERSION"))) {
  await pg.initialise();
}

await pg.start();

try {
  await pg.createDatabase("nexport");
} catch (error) {
  const text = String(error);
  if (!/already exists/i.test(text)) {
    throw error;
  }
}

console.log("PostgreSQL is running at postgresql://postgres:postgres@localhost:5432/nexport");
console.log("Leave this process running, then in another terminal: npm run db:deploy");
