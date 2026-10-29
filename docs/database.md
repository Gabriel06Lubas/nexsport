# Database: PostgreSQL + Drizzle ORM

nexport uses [Drizzle ORM](https://orm.drizzle.team) with the `node-postgres`
(`pg`) driver, and **Drizzle Kit** for migrations and Drizzle Studio. The
layout follows the Drizzle "Get started with PostgreSQL" guide: a
`drizzle.config.ts` at the root, migrations in `drizzle/`, and the schema
under `src/db/`. The schema is split into one file per domain, which the
guide's `drizzle.config.ts` docs support.

```
📦 nexport
 ├ 📂 drizzle                      migrations (generated) + meta/ snapshots
 │  ├ 📜 0000_init.sql             all tables, enums, CHECKs, indexes, FKs
 │  ├ 📜 0001_booking_guards.sql   custom SQL: exclusion constraint + triggers
 │  └ 📂 meta                      Drizzle Kit snapshots and journal (commit these)
 ├ 📂 src/db
 │  ├ 📜 index.ts                  the `db` client (Drizzle on a pg Pool)
 │  ├ 📜 columns.ts                shared column/constraint builders
 │  ├ 📜 errors.ts                 isUniqueViolation / isBookingConflict
 │  └ 📂 schema
 │     ├ 📜 index.ts               entry point re-exporting everything below
 │     ├ 📜 enums.ts
 │     ├ 📜 auth.ts                User, Account, Session, Profile, Follow
 │     ├ 📜 clubs.ts               Club, Sport, AgeGroup, ClubMember, Facility, Equipment, …
 │     ├ 📜 scheduling.ts          PracticeSession, SessionParticipant, Attendance, EquipmentBooking
 │     ├ 📜 social.ts              Post, Comment, Like + messaging
 │     ├ 📜 billing.ts             Subscription, StripeAccount, payments, policies
 │     ├ 📜 notifications.ts
 │     └ 📜 relations.ts           relations for db.query.* and Drizzle Studio
 ├ 📂 scripts
 │  ├ 📜 local-postgres.mjs        npm run db:up: local PostgreSQL for testing
 │  └ 📜 db-migrate.mjs            npm run db:migrate
 ├ 📂 tests/db                     SQL integration + race tests for the guards
 └ 📜 drizzle.config.ts
```

## Commands

| Command | What it does |
| --- | --- |
| `npm run db:up` | Starts a local PostgreSQL 17 (from the `embedded-postgres` dev dependency) with the port, user and database from `DATABASE_URL`. Data lives in `.local/pgdata`. Leave it running; Ctrl+C stops it. |
| `npm run db:migrate` | Applies pending migrations from `drizzle/` |
| `npm run db:studio` | Opens **Drizzle Studio**: browse and edit data at https://local.drizzle.studio |
| `npm run db:generate` | Creates a new migration from schema changes (`drizzle-kit generate`) |
| `npm run db:check` | Checks the migration history is consistent (`drizzle-kit check`) |
| `npm run db:test` | Runs the booking-guard integration and race tests |

All of them read `DATABASE_URL` from `.env`, e.g.
`DATABASE_URL="postgresql://postgres:postgres@localhost:5432/nexport"`.

**Why `db:migrate` isn't plain `drizzle-kit migrate`:** with drizzle-kit
0.31, a failing migration exits with code 1 but prints nothing. The script
uses Drizzle's documented programmatic migrator instead, which reads the same
files and records progress in the same table
(`drizzle.__drizzle_migrations`), and prints the actual SQL error. If the
database was originally set up by the old Prisma migrations, it says how to
reset the local database.

## Local database (`npm run db:up`)

`db:up` needs nothing installed system-wide: npm downloads real PostgreSQL 17
binaries for your OS as part of `npm install`. The first run creates a
UTF-8 database cluster in `.local/pgdata`, using PostgreSQL's built-in
`C.UTF-8` locale so accented names sort and compare the same on every OS.
Later runs reuse it.

| Problem | Fix |
| --- | --- |
| `Port 5432 is already in use` | Another PostgreSQL is running (a system install, Docker, or a `db:up` still open in another terminal). Stop it, or change the port in `DATABASE_URL` (e.g. `localhost:5433`) and run `db:up` again. The app and `db:migrate` follow the same URL. |
| `DATABASE_URL points at <host>, not this machine` | `db:up` only runs a local server. Point `DATABASE_URL` at `localhost`. |
| `type "…" already exists` from `db:migrate` | The database was set up by the old Prisma migrations. Stop `db:up`, delete `.local/pgdata`, start `db:up` again, then `db:migrate`. |
| Running as root (Docker, dev containers) | Handled: PostgreSQL won't run as root, so `db:up` runs it as a `postgres` user it creates. |
| A first run was interrupted | Handled: the half-created `.local/pgdata` is removed and set up again. |
| Start over with an empty database | Stop `db:up`, delete `.local/pgdata`, start it again. |

The user and password only take effect when `.local/pgdata` is first
created; to change them later, delete `.local/pgdata`.

## Using the client

```ts
import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { practiceSession, session } from "@/db/schema";

// SQL-like queries
await db.select().from(session).where(eq(session.userId, userId)).orderBy(desc(session.lastSeenAt));

// Relational queries (uses src/db/schema/relations.ts)
await db.query.practiceSession.findFirst({
  where: eq(practiceSession.id, id),
  with: { facility: true, participants: { with: { user: true } } },
});

// Transactions
await db.transaction(async (tx) => {
  /* tx.insert(...), tx.update(...) */
});
```

Table and column names in Postgres are unchanged from the Prisma era
(`"PracticeSession"."startsAt"`), so raw SQL, the guards and the tests work as
before. In TypeScript, tables are camelCase exports (`practiceSession`).

## Changing the schema

1. Edit the table in `src/db/schema/<domain>.ts`.
2. `npm run db:generate -- --name=<what_changed>`, and review the SQL in `drizzle/`.
3. `npm run db:migrate`.
4. Commit the schema change, the new `.sql` file and `drizzle/meta/`.

For things Drizzle Kit can't express (triggers, exclusion constraints,
extensions, data backfills), create an empty migration and write the SQL:

```bash
npx drizzle-kit generate --custom --name=<what_changed>
```

**Don't use `drizzle-kit push` on this database.** `push` compares the
schema with the live database directly, and it doesn't know about the
exclusion constraint and triggers in `0001_booking_guards.sql`. Always use
`generate` + `migrate`.

## Design notes

- **Constraint names are explicit.** Foreign keys, indexes and unique keys
  keep the `<Table>_<cols>_fkey|_idx|_key` names (helpers in
  `src/db/columns.ts`). The guards, the SQL tests and the app's error handling
  (`isUniqueViolation(e, "Profile_handle_key")`) refer to constraints by name.
- **IDs** are generated in the app with `cuid2`, as text primary keys.
- **`updatedAt`** is set by Drizzle on insert and on every update made through
  it (`$onUpdate`). Raw SQL updates must set it themselves.
- **The three composite-FK targets** (`Facility`, `Equipment`,
  `PracticeSession` on `(id, clubId)`) are `UNIQUE` constraints rather than
  unique indexes. Drizzle Kit adds foreign keys before indexes, so an index
  wouldn't exist yet when the keys referencing it are created.
- **Descending indexes** use `.desc().nullsFirst()` to match Postgres's
  default for `ORDER BY … DESC`, so those queries can use the index.

## Verification

The port was checked against the database the old Prisma migrations built:

- **Schema diff:** both databases were dumped with `pg_dump --schema-only` and
  diffed. Every table, column type, default, CHECK, index, foreign key (names
  and `ON DELETE` actions), enum, trigger and the exclusion constraint match.
  The only differences are deliberate:
  - The array columns `ClubMember.permissions` and
    `StripeAccount.requirementsDue` are now `NOT NULL` (they always defaulted
    to `[]`).
  - The three composite-FK targets are constraints instead of indexes (see
    above).
  - Column order differs in `User` and `Session`; it has no effect.
- `drizzle-kit check` and `drizzle-kit generate` report no drift between the
  schema and the migrations.
- `npm run db:test`: 20/20 guard scenarios pass. The race test (same court,
  last ball machine, last seat) passes at all three isolation levels, 3 runs
  in a row.
- `npm run test:e2e`: all 32 sign-in, session and RBAC checks pass on the
  Drizzle adapter. That now includes a taken profile handle being reported
  rather than crashing.
- Drizzle Studio starts and serves the schema with its relations.
- A fresh clone runs `npm ci`, `npm run build` and `npm run dev` with no
  `.env`. No code-generation step is needed any more.
