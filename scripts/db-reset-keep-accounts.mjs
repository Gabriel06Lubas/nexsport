// npm run db:reset-keep-accounts: empties a LOCAL database for manual
// testing, keeping only the accounts, so everyone can still sign in.
//
//   npm run db:reset-keep-accounts            dry run: shows what would go
//   npm run db:reset-keep-accounts -- --yes   does it
//
// Kept: users and their sign-ins (User, Account, Session), personal details
// (Profile, ProfileSport, AthleteSettings), and the structural data that
// belongs to no club or user: the sports catalogue (Sport) and the plans
// (SubscriptionPlan, with their limits, fees and Stripe Price ids). The
// migration history (drizzle schema) is never touched.
// Deleted: every other table: clubs, courts, bookings, sessions, payments,
// subscriptions, passes, plan checkouts, notifications, social posts, logs.
// New tables are deleted by default; add one to KEEP to keep it.
//
// Roles stay as they are: a club owner keeps CLUB_OWNER but has no club (the
// club dashboard offers to set one up, through Checkout), coaches lose a Pro
// subscription and are on Free Coach, staff have no club.
//
// Refuses to run in production or against a non-local database, like the seed.
import "dotenv/config";

import pg from "pg";

const KEEP = new Set(["User", "Account", "Session", "Profile", "ProfileSport", "AthleteSettings", "Sport", "SubscriptionPlan"]);

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
if (process.env.NODE_ENV === "production") throw new Error("Refusing to reset a database in production");
const host = new URL(url).hostname;
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
  throw new Error(`Refusing to reset a non-local database (${host}). This is for local testing only.`);
}
const apply = process.argv.includes("--yes");

const db = new pg.Client({ connectionString: url.split("?")[0] });
await db.connect();
try {
  const { rows: tables } = await db.query(
    `SELECT c.relname AS name FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' ORDER BY 1`,
  );
  const wipe = tables.map((t) => t.name).filter((t) => !KEEP.has(t));
  const count = async (t) => Number((await db.query(`SELECT count(*) FROM "${t.replaceAll('"', '""')}"`)).rows[0].count);

  console.log(apply ? "Deleting:" : "Dry run. Would delete (run with -- --yes to do it):");
  let total = 0;
  for (const t of wipe) {
    const n = await count(t);
    total += n;
    if (n) console.log(`  ${t.padEnd(26)} ${n}`);
  }
  console.log(`  ${"total".padEnd(26)} ${total} rows in ${wipe.length} tables`);
  console.log("Keeping (accounts and structural data):");
  for (const t of KEEP) console.log(`  ${t.padEnd(26)} ${await count(t)}`);
  if (!apply) process.exit(0);

  const { rows: [me] } = await db.query(`SELECT rolsuper FROM pg_roles WHERE rolname = current_user`);
  if (!me?.rolsuper) throw new Error("Needs a superuser connection (to skip FK checks while emptying tables), e.g. the postgres user of `npm run db:up`.");

  await db.query("BEGIN");
  // Kept rows that point at deleted ones: the user's last club, and admin
  // impersonation sessions (whose audit log is deleted).
  await db.query(`UPDATE "User" SET "activeClubId" = NULL WHERE "activeClubId" IS NOT NULL`);
  await db.query(`DELETE FROM "Session" WHERE "impersonatorId" IS NOT NULL`);
  // FK triggers off for this transaction only: tables can be emptied in any
  // order without cascades fighting RESTRICT rules. Nothing kept references
  // a deleted table any more (checked below before committing).
  await db.query("SET LOCAL session_replication_role = replica");
  for (const t of wipe) await db.query(`DELETE FROM "${t.replaceAll('"', '""')}"`);
  await db.query("SET LOCAL session_replication_role = origin");
  const { rows: dangling } = await db.query(`
    SELECT c.conrelid::regclass::text AS tbl, c.conname FROM pg_constraint c
     WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
       AND c.conrelid::regclass::text = ANY($1) AND NOT (c.confrelid::regclass::text = ANY($1))`, [[...KEEP].map((t) => `"${t}"`)]);
  for (const { tbl, conname } of dangling) {
    // A kept table referencing a deleted one must not keep a value there.
    const { rows: [def] } = await db.query(`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = $1`, [conname]);
    const col = def.d.match(/FOREIGN KEY \(([^)]+)\)/)[1].split(",")[0].trim();
    const { rows: [left] } = await db.query(`SELECT count(*)::int AS n FROM ${tbl} WHERE ${col} IS NOT NULL`);
    if (left.n) throw new Error(`${tbl}.${col} still references deleted rows (${conname}); nothing was changed`);
  }
  await db.query("COMMIT");
  console.log(`Done: ${total} rows deleted. Sign in with any existing account to test from scratch.`);
} catch (error) {
  await db.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await db.end();
}
