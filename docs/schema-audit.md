# Database schema audit (November 2026)

An audit of nexport's PostgreSQL schema (46 tables, migrations 0000–0013)
against four goals:
1. production-ready and normalised;
2. safe against races, court double-bookings above all;
3. fast analytics;
4. multi-tenant isolation.

The fixes are in migration **0014_schema_hardening**. Every finding below
was checked against the live schema (`pg_catalog` queries) or measured with
`EXPLAIN ANALYZE` on a database loaded with realistic volume. It is not a
generic checklist.

## 1. Audit report

### What was already sound (kept as is)

| Requirement | Where it stands |
| --- | --- |
| `btree_gist` and exclusion constraints on `tstzrange(start, end, '[)')` | `FacilityBooking_no_overlap` and `PracticeSession_facility_no_overlap` (one court, one booking at a time), plus `PracticeSession_coach_no_overlap` (a coach is never in two places at once). Ranges are half-open `[)`, so 10:00–11:00 and 11:00–12:00 don't clash. |
| A court rented and coached at once | Two tables share one court, which one exclusion constraint can't span. The `FacilityBooking_session_overlap_guard` and `PracticeSession_rental_overlap_guard` triggers lock the facility row and check the other table. `tests/db/booking_races.sh` races both under READ COMMITTED, REPEATABLE READ and SERIALIZABLE. |
| Roles and plan tiers as ENUMs | `UserRole` (`ADMIN, CLUB_OWNER, STAFF, COACH, STUDENT`), `SubscriptionTier` (`FREE_COACH, PRO_COACH, CLUB_BASIC, CLUB_ENTERPRISE`), plus 32 other enums, e.g. every status. |
| Stripe metadata | `User.stripeCustomerId` and `Club.stripeCustomerId`. `Subscription` holds `stripeSubscriptionId`, `status`, `currentPeriodStart` and `currentPeriodEnd`, with at most one live subscription per club or user (`Subscription_one_live_per_club`, `Subscription_one_live_per_user`). |
| Plan limits | `SubscriptionPlan.maxFacilities`, `maxStaff` and `maxAthletes` (Club Basic: 5 courts; Free Coach: 15 students), enforced under a row lock (`src/lib/entitlements.ts`). |
| Split payments for open matches | One `PaymentTransaction` per `SessionParticipant` (`PaymentTransaction_one_live_per_participant`), with each seat's share. A capacity trigger stops a match being oversold. |
| Money and time | Money is integer minor units; there are no float or numeric money columns. Every timestamp is `timestamptz(3)`. |
| Tenant FKs on the main paths | Composite FKs such as `(facilityId, clubId) → Facility(id, clubId)` mean a booking, price rule, rental payment or pass can't point at another club's court or plan. |
| `(clubId, …)` indexes | 21 of the 24 tables with `clubId` already had an index leading with it, e.g. `(clubId, startsAt)` for schedules and `(clubId, kind, paidAt)` for revenue. |

### Flaws found and fixed in 0014

| # | Finding | Risk | Fix |
| --- | --- | --- | --- |
| 1 | **9 references between two club-owned tables didn't include `clubId`**: <br>– `PaymentTransaction.sessionId`, `.cancellationPolicyId`;<br>– `CoachAssignment.coachMemberId`, `.studentMemberId`, `.ageGroupId`;<br>– `ClubMember.ageGroupId`;<br>– `PracticeSession.ageGroupId`, `.cancellationPolicyId`;<br>– `PassCreditAdjustment.sessionId`. | Tenant isolation rested only on application code. One bug could record club A's payment against club B's session (wrong revenue and payouts), or pair members of two clubs. | A composite `<Table>_<col>_same_club_fkey` FK to `(id, clubId)` for each (with new unique keys on `ClubMember`, `AgeGroup` and `CancellationPolicy`). Each keeps its original delete behaviour; `SET NULL` clears only the key column (`ON DELETE SET NULL ("col")`, PostgreSQL 15+), never `clubId`. |
| 2 | **34 foreign keys had no index on their column** (24 point at `User`; 7 of those are on `FacilityBooking`, `PracticeSession` and `SessionParticipant`). | Deleting the parent scans the whole child table while holding locks. The app hard-deletes users (the Auth.js adapter's `deleteUser`), so erasing one account would scan every booking, session and message table. | `<Table>_<col>_fk_idx` on each. Nullable, mostly-empty keys (`cancelledById`, `ageGroupId`, …) get a partial `WHERE col IS NOT NULL` index, which serves the FK lookup and stays tiny. |
| 3 | **`updatedAt` had no default and no trigger.** It was set only by Drizzle in app code. | Updates from raw SQL, the database's own guard triggers (equipment sync, capacity), the seed and `stripe:plans` left it stale, so the column couldn't be trusted for audits or incremental exports. | `DEFAULT now()` on all 30 columns, plus a `BEFORE UPDATE` trigger `<Table>_touch_updated_at` (`nexport_touch_updated_at()`). A no-op update keeps the old value. |
| 4 | **A court hold's expiry lived only on its payment** (`PaymentTransaction.checkoutExpiresAt`). | A `PENDING` booking whose payment row was missing, or closed without releasing the slot, would block the court forever. The exclusion constraint counts `PENDING` rows, as it should. | `FacilityBooking.holdExpiresAt`, required while `PENDING` (`FacilityBooking_hold_consistent`), set to now + 15 minutes. The sweeper also cancels lapsed holds that have no live payment, using a partial index on open holds (`FacilityBooking_open_holds_idx`). |
| 5 | **The overview's time windows weren't indexable.** Utilisation and the heatmap could only bound `startsAt < now()`, because the window's lower bound is on `endsAt`. The revenue chart filtered `FacilityBooking` and `MemberPass` on `paidAt`, which had no index. | Each page view read the club's whole booking history, so the cost grew every year. | Bookings and sessions capped at 24 hours (`*_max_duration` checks; forms already cap at 8 hours), so queries also bound `startsAt > from − 1 day`. Indexes on `(clubId, paidAt)` for `FacilityBooking` and `MemberPass`. See §3. |

### Requested changes I recommend against (not applied)

| Request | Why not | If you still want it |
| --- | --- | --- |
| Exclusion constraint only `WHERE status = 'CONFIRMED'` | It would let two unpaid holds for the same slot coexist: two customers pay for one court and one must be refunded. The current `status <> 'CANCELLED'` makes a hold (`PENDING`) block the slot for its 15 minutes, which is the point of a hold. | — |
| Rename every table and column to `snake_case` | The schema is consistently PascalCase tables and camelCase columns, a documented convention (`src/db/columns.ts`). Constraint names are part of the app's contract: error handling, SQL tests and raw-SQL queries refer to them. A rename rewrites every query, test and the seed, for no runtime, performance or security gain. | Read-only `snake_case` views in an `analytics` schema for BI tools, without touching the app. |
| Switch primary keys to `UUID` (`gen_random_uuid()`) | Ids are cuid2 (random, non-enumerable, URL-safe), generated in the app. Random UUIDv4 has the same B-tree locality as cuid2, so a conversion would rewrite every PK and FK on 46 tables for a modest storage saving (16 bytes vs about 25). | If you migrate one day, use time-ordered UUIDv7 (native `uuidv7()` from PostgreSQL 18). It's the version that improves index locality. |
| Rename enum values (`CLUB_STAFF`, `FREE`, `PRO`, `BASIC`, `ENTERPRISE`) | They're already enums. `FREE` alone is ambiguous between Free Coach and an athlete account, and the tier names appear in Stripe metadata, `plans.json` and the code. | — |
| Duplicate `subscription_status` and `current_period_end` onto `Club` and `User` | That denormalises the data. The `Subscription` row the webhook keeps in sync is the single source, and two copies drift. The entitlement checks read it with one indexed lookup. | — |
| A 15-minute hold for open-match seats | Court holds are 15 minutes. Seats are paid in Stripe Checkout, whose minimum `expires_at` is 30 minutes, so seat holds are 35 minutes. | — |

### Remaining risk: no row-level security

Tenant isolation is enforced in two layers:
- the Data Access Layer: every query is scoped to the club the session's membership allows;
- the composite FKs above.

PostgreSQL row-level security would add a third, so a missed `WHERE "clubId" = …` would return nothing instead of another club's rows. It isn't a migration-only change:
1. the app must connect as a role that doesn't own the tables (owners bypass RLS);
2. each request must `SET LOCAL` its user and allowed clubs;
3. policies are needed for the legitimate cross-club readers: athletes booking at any club, coaches at several clubs, admins, and the Stripe webhook.

I recommend it as its own project, starting with the money tables (`PaymentTransaction`, `PaymentTransfer`, `MemberPass`).

## 2. SQL migration

- `drizzle/0014_schema_hardening.sql`: the migration itself (applied by
  `npm run db:migrate`, in one transaction with any other pending
  migrations).
- The complete schema as DDL is the migrations applied in journal order.
  `npm run db:schema` prints them as one script.

**Production rollout:**
- Plain `CREATE INDEX` blocks writes to that table while it builds. On the
  small tables it's instant.
- If `FacilityBooking`, `PracticeSession` or `Notification` have grown large
  by the time this ships, create their new indexes `CONCURRENTLY` by hand
  before migrating. The migration's `CREATE INDEX` then fails on the
  existing name, so change those statements to `IF NOT EXISTS`.
- The 9 FKs validate existing rows. Production data had 0 violations
  (checked before adding them).

## 3. Query optimization notes

Measured with `EXPLAIN (ANALYZE, BUFFERS)` on a copy loaded with 473,000
court bookings across 31 clubs: one club had a year of history (16,000
bookings), plus 40,000 passes and 6,000 online payments.

| Query (club overview) | Before | After | Why |
| --- | --- | --- | --- |
| Utilisation, last 30 days | 15,934 booking rows read · 10.9 ms | 1,429 rows · 2.3 ms | `startsAt` bounded on both sides, so `(clubId, startsAt)` reads only the window. Before, the cost grew with every year of history; now it's constant. |
| Peak-hours heatmap, 28 days | 15,934 rows · 8.9 ms | 1,325 rows · 11.4 ms | Same bound. The time is now dominated by expanding bookings into hourly slots, not by reading. |
| Revenue, 6 months | all 16,026 club bookings and a seq scan of passes · 26.7 ms | `(clubId, paidAt)` index scans of the window only · 21.6 ms | Desk payments are dated by `paidAt`; the new indexes serve the range directly. |
| Booking overlap pre-check | 0.6 ms | 0.6 ms | `(facilityId, startsAt)` was already right; the exclusion constraint's GiST index is the real guarantee. |

At one year of data the time saved is small. The point is the shape:
utilisation and the heatmap no longer get slower as history grows, and
revenue scans six months, not the whole archive.

Why the key constraints and indexes are set up as they are:
- **Exclusion constraints** use `tstzrange(start, end, '[)')` with
  `status <> 'CANCELLED'`. `PENDING` holds block the slot, and back-to-back
  bookings don't collide. The GiST index behind each constraint also
  answers "is this court free" lookups.
- **Composite tenant FKs `(x, clubId) → (id, clubId)`** need a unique
  `(id, clubId)` on the target. It costs one small index per parent and
  makes cross-club references impossible, not just unlikely.
- **FK indexes are partial (`WHERE col IS NOT NULL`)** where the key is
  usually empty (`cancelledById`, `ageGroupId`, notification targets).
  PostgreSQL uses them for the `col = $1` lookups its FK actions run, at a
  fraction of a full index's size and write cost.
- **`(clubId, …)` leads every tenant index.** Each dashboard query filters
  one club first, so the club's rows are contiguous in the index and other
  tenants' data is never read.
- **Partial indexes for small hot slices**, such as open holds
  (`FacilityBooking_open_holds_idx`, `WHERE status = 'PENDING'`). The
  sweeper runs before every availability check, and the index stays tiny
  however many bookings exist.
- **The `updatedAt` trigger skips no-op updates** (`NEW IS DISTINCT FROM
  OLD`), so re-saving unchanged data doesn't look like a change.

`tests/db/schema_contract.test.sql` now also checks:
- every FK has an index;
- every `updatedAt` column has its default and trigger;
- the 9 same-club FKs exist and refuse a cross-club row;
- `SET NULL` keeps `clubId`;
- a raw `UPDATE` moves `updatedAt`;
- a `PENDING` booking needs `holdExpiresAt`.

A later migration that undoes any of these fails `npm run db:test`.
