#!/usr/bin/env bash
# Concurrency test for the booking guards: two transactions race for the same
# facility slot, the last unit of equipment, and the last seat in a session,
# at every isolation level. Exactly one of each pair must win.
#
# Like the app, workers retry on 40001 serialization_failure: under
# SERIALIZABLE, Postgres may abort *both* racers (never admit both), and
# the retry is what lets one of them through.
#
#   DATABASE_URL=postgresql://... tests/db/booking_races.sh
#
# Creates rows prefixed "race_" and deletes them afterwards.
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL}"
URL="${DATABASE_URL%%\?*}"
P=(psql "$URL" -q -X -v ON_ERROR_STOP=1)

cleanup() {
  "${P[@]}" >/dev/null <<'SQL'
DELETE FROM "SessionParticipant" WHERE id LIKE 'race_%';
DELETE FROM "EquipmentBooking" WHERE id LIKE 'race_%';
DELETE FROM "PracticeSession" WHERE id LIKE 'race_%';
DELETE FROM "Equipment" WHERE id LIKE 'race_%';
DELETE FROM "Facility" WHERE id LIKE 'race_%';
DELETE FROM "Club" WHERE id LIKE 'race_%';
DELETE FROM "Sport" WHERE id LIKE 'race_%';
DELETE FROM "User" WHERE id LIKE 'race_%';
SQL
}
trap cleanup EXIT
cleanup

"${P[@]}" >/dev/null <<'SQL'
INSERT INTO "User" (id, email, "updatedAt") VALUES
  ('race_u', 'race_u@test.dev', now()), ('race_s1', 'race_s1@test.dev', now()), ('race_s2', 'race_s2@test.dev', now());
INSERT INTO "Club" (id, slug, name, country, "ownerId", "updatedAt") VALUES ('race_c', 'race-club', 'Race', 'ES', 'race_u', now());
INSERT INTO "Sport" (id, slug, name) VALUES ('race_sp', 'race-sport', 'Race');
INSERT INTO "Facility" (id, "clubId", name, type, "updatedAt") VALUES
  ('race_f1', 'race_c', 'A', 'OTHER', now()), ('race_f2', 'race_c', 'B', 'OTHER', now());
INSERT INTO "Equipment" (id, "clubId", name, quantity, "updatedAt") VALUES ('race_e', 'race_c', 'Machine', 1, now());
SQL

# run_tx <<SQL: run one transaction from stdin, retrying on serialization failure.
run_tx() {
  local sql attempt err
  sql=$(cat)
  for attempt in 1 2 3 4 5; do
    if err=$("${P[@]}" 2>&1 >/dev/null <<<"$sql"); then return 0; fi
    grep -q "could not serialize" <<<"$err" || return 0 # lost the race: expected
    sleep "0.0$((RANDOM % 9 + 1))"
  done
}

fail=0
for iso in "READ COMMITTED" "REPEATABLE READ" "SERIALIZABLE"; do
  "${P[@]}" >/dev/null <<'SQL'
DELETE FROM "SessionParticipant" WHERE id LIKE 'race_%';
DELETE FROM "EquipmentBooking" WHERE id LIKE 'race_%';
DELETE FROM "PracticeSession" WHERE id LIKE 'race_%';
INSERT INTO "PracticeSession" (id, "clubId", "facilityId", "coachId", "sportId", "createdById", title, "startsAt", "endsAt", "maxParticipants", "updatedAt") VALUES
  ('race_s1', 'race_c', 'race_f1', 'race_u', 'race_sp', 'race_u', '1', '2031-01-01 10:00Z', '2031-01-01 11:00Z', 1, now()),
  ('race_s2', 'race_c', 'race_f2', 'race_u', 'race_sp', 'race_u', '2', '2031-01-01 10:00Z', '2031-01-01 11:00Z', NULL, now());
SQL
  for i in 1 2; do
    # Each transaction takes its snapshot first, then waits so both overlap.
    run_tx <<SQL &
BEGIN ISOLATION LEVEL $iso;
SELECT count(*) FROM "PracticeSession";
SELECT pg_sleep(0.3);
INSERT INTO "PracticeSession" (id, "clubId", "facilityId", "coachId", "sportId", "createdById", title, "startsAt", "endsAt", "updatedAt")
  VALUES ('race_q$i', 'race_c', 'race_f1', 'race_u', 'race_sp', 'race_u', 'q', '2031-02-01 10:00Z', '2031-02-01 11:00Z', now());
SELECT pg_sleep(1);
COMMIT;
SQL
    run_tx <<SQL &
BEGIN ISOLATION LEVEL $iso;
SELECT count(*) FROM "EquipmentBooking";
SELECT pg_sleep(0.3);
INSERT INTO "EquipmentBooking" (id, "clubId", "equipmentId", "sessionId", quantity, "startsAt", "endsAt", "updatedAt")
  VALUES ('race_b$i', 'race_c', 'race_e', 'race_s$i', 1, '2031-01-01 10:00Z', '2031-01-01 11:00Z', now());
SELECT pg_sleep(1);
COMMIT;
SQL
    run_tx <<SQL &
BEGIN ISOLATION LEVEL $iso;
SELECT count(*) FROM "SessionParticipant";
SELECT pg_sleep(0.3);
INSERT INTO "SessionParticipant" (id, "sessionId", "userId", status, "updatedAt")
  VALUES ('race_p$i', 'race_s1', 'race_s$i', 'ACCEPTED', now());
SELECT pg_sleep(1);
COMMIT;
SQL
  done
  wait || true
  read -r fac eq seats < <("${P[@]}" -At -F ' ' -c "
    SELECT (SELECT count(*) FROM \"PracticeSession\" WHERE id LIKE 'race_q%'),
           (SELECT count(*) FROM \"EquipmentBooking\" WHERE id LIKE 'race_b%'),
           (SELECT count(*) FROM \"SessionParticipant\" WHERE id LIKE 'race_p%')")
  status=PASS
  [[ "$fac" == 1 && "$eq" == 1 && "$seats" == 1 ]] || { status=FAIL; fail=1; }
  printf '%-16s facility=%s equipment=%s seats=%s  %s\n' "$iso" "$fac" "$eq" "$seats" "$status"
done
exit $fail
