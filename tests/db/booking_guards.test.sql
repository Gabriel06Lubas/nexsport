-- Integration test for the DB-level booking guards.
-- Run against a freshly migrated database:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/db/booking_guards.test.sql
-- Everything runs in one transaction that is rolled back at the end.
BEGIN;

INSERT INTO "User" (id, email, role, "updatedAt") VALUES
  ('u_owner', 'owner@test.dev', 'CLUB_OWNER', now()),
  ('u_coach', 'coach@test.dev', 'COACH', now()),
  ('u_coach2', 'coach2@test.dev', 'COACH', now()),
  ('u_coach3', 'coach3@test.dev', 'COACH', now()),
  ('u_s1', 's1@test.dev', 'STUDENT', now()),
  ('u_s2', 's2@test.dev', 'STUDENT', now());
INSERT INTO "Club" (id, slug, name, country, "ownerId", "updatedAt")
  VALUES ('c1', 'guard-test-club', 'Padel Central', 'ES', 'u_owner', now()),
         ('c2', 'guard-test-other', 'Other', 'ES', 'u_owner', now());
INSERT INTO "Sport" (id, slug, name) VALUES ('sp_padel', 'guard-test-padel', 'Padel');
INSERT INTO "Facility" (id, "clubId", name, type, "updatedAt") VALUES
  ('f1', 'c1', 'Court 1', 'PADEL_COURT', now()),
  ('f_other', 'c2', 'Court X', 'PADEL_COURT', now());
INSERT INTO "Equipment" (id, "clubId", name, quantity, "updatedAt") VALUES
  ('e_balls', 'c1', 'Ball tubes', 10, now()),
  ('e_machine', 'c1', 'Ball machine', 1, now());

CREATE TEMP TABLE results (name text, passed boolean);

CREATE FUNCTION pg_temp.expect_violation(p_name text, p_sql text, p_constraint text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE c text;
BEGIN
  BEGIN
    EXECUTE p_sql;
    INSERT INTO results VALUES (p_name, false);
  EXCEPTION WHEN exclusion_violation OR check_violation OR foreign_key_violation OR unique_violation THEN
    GET STACKED DIAGNOSTICS c = CONSTRAINT_NAME;
    INSERT INTO results VALUES (p_name, c = p_constraint);
    IF c <> p_constraint THEN RAISE NOTICE '% raised % (expected %)', p_name, c, p_constraint; END IF;
  END;
END $$;

CREATE FUNCTION pg_temp.expect_ok(p_name text, p_sql text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  INSERT INTO results VALUES (p_name, true);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '% failed: %', p_name, SQLERRM;
  INSERT INTO results VALUES (p_name, false);
END $$;

-- Base session 10:00-11:00
INSERT INTO "PracticeSession" (id, "clubId", "facilityId", "coachId", "sportId", "createdById", title, "startsAt", "endsAt", "maxParticipants", "updatedAt")
VALUES ('s_a', 'c1', 'f1', 'u_coach', 'sp_padel', 'u_coach', 'A', '2030-01-01 10:00Z', '2030-01-01 11:00Z', 1, now());

-- Facility guard
SELECT pg_temp.expect_violation('facility: overlapping session rejected',
  $q$INSERT INTO "PracticeSession" (id,"clubId","facilityId","coachId","sportId","createdById",title,"startsAt","endsAt","updatedAt")
     VALUES ('s_b','c1','f1','u_coach','sp_padel','u_coach','B','2030-01-01 10:30Z','2030-01-01 11:30Z',now())$q$,
  'PracticeSession_facility_no_overlap');
SELECT pg_temp.expect_ok('facility: back-to-back session allowed',
  $q$INSERT INTO "PracticeSession" (id,"clubId","facilityId","coachId","sportId","createdById",title,"startsAt","endsAt","updatedAt")
     VALUES ('s_c','c1','f1','u_coach','sp_padel','u_coach','C','2030-01-01 11:00Z','2030-01-01 12:00Z',now())$q$);
SELECT pg_temp.expect_violation('facility: cross-tenant facility rejected',
  $q$INSERT INTO "PracticeSession" (id,"clubId","facilityId","coachId","sportId","createdById",title,"startsAt","endsAt","updatedAt")
     VALUES ('s_x','c1','f_other','u_coach','sp_padel','u_coach','X','2030-02-01 10:00Z','2030-02-01 11:00Z',now())$q$,
  'PracticeSession_facilityId_clubId_fkey');
SELECT pg_temp.expect_violation('session: end before start rejected',
  $q$INSERT INTO "PracticeSession" (id,"clubId","facilityId","coachId","sportId","createdById",title,"startsAt","endsAt","updatedAt")
     VALUES ('s_y','c1','f1','u_coach','sp_padel','u_coach','Y','2030-03-01 11:00Z','2030-03-01 10:00Z',now())$q$,
  'PracticeSession_time_order');
SELECT pg_temp.expect_ok('facility: slot reusable after cancellation', $q$
  UPDATE "PracticeSession" SET status='CANCELLED', "cancelledAt"=now() WHERE id='s_c';
  INSERT INTO "PracticeSession" (id,"clubId","facilityId","coachId","sportId","createdById",title,"startsAt","endsAt","updatedAt")
     VALUES ('s_d','c1','f1','u_coach','sp_padel','u_coach','D','2030-01-01 11:00Z','2030-01-01 12:00Z',now())$q$);

-- Equipment guard (s_a 10-11, s_d 11-12; add s_e 10:30-11:30 on another
-- facility, with another coach: one coach can't be in two sessions at once)
INSERT INTO "Facility" (id, "clubId", name, type, "updatedAt") VALUES ('f2', 'c1', 'Court 2', 'PADEL_COURT', now());
INSERT INTO "PracticeSession" (id,"clubId","facilityId","coachId","sportId","createdById",title,"startsAt","endsAt","updatedAt")
  VALUES ('s_e','c1','f2','u_coach2','sp_padel','u_coach2','E','2030-01-01 10:30Z','2030-01-01 11:30Z',now());

SELECT pg_temp.expect_ok('equipment: 6 of 10 balls reserved',
  $q$INSERT INTO "EquipmentBooking" (id,"clubId","equipmentId","sessionId",quantity,"startsAt","endsAt","updatedAt")
     VALUES ('eb1','c1','e_balls','s_a',6,'2030-01-01 10:00Z','2030-01-01 11:00Z',now())$q$);
SELECT pg_temp.expect_violation('equipment: overlapping 5 more balls rejected',
  $q$INSERT INTO "EquipmentBooking" (id,"clubId","equipmentId","sessionId",quantity,"startsAt","endsAt","updatedAt")
     VALUES ('eb2','c1','e_balls','s_e',5,'2030-01-01 10:30Z','2030-01-01 11:30Z',now())$q$,
  'EquipmentBooking_capacity');
SELECT pg_temp.expect_ok('equipment: overlapping 4 more balls allowed',
  $q$INSERT INTO "EquipmentBooking" (id,"clubId","equipmentId","sessionId",quantity,"startsAt","endsAt","updatedAt")
     VALUES ('eb3','c1','e_balls','s_e',4,'2030-01-01 10:30Z','2030-01-01 11:30Z',now())$q$);
SELECT pg_temp.expect_ok('equipment: unique machine booked',
  $q$INSERT INTO "EquipmentBooking" (id,"clubId","equipmentId","sessionId",quantity,"startsAt","endsAt","updatedAt")
     VALUES ('eb4','c1','e_machine','s_a',1,'2030-01-01 10:00Z','2030-01-01 11:00Z',now())$q$);
SELECT pg_temp.expect_violation('equipment: machine double-booked rejected',
  $q$INSERT INTO "EquipmentBooking" (id,"clubId","equipmentId","sessionId",quantity,"startsAt","endsAt","updatedAt")
     VALUES ('eb5','c1','e_machine','s_e',1,'2030-01-01 10:30Z','2030-01-01 11:30Z',now())$q$,
  'EquipmentBooking_capacity');
SELECT pg_temp.expect_violation('equipment: stock reduction below reservations rejected',
  $q$UPDATE "Equipment" SET quantity = 9 WHERE id = 'e_balls'$q$,
  'EquipmentBooking_capacity');
INSERT INTO "Facility" (id, "clubId", name, type, "updatedAt") VALUES ('f3', 'c1', 'Court 3', 'PADEL_COURT', now());
INSERT INTO "PracticeSession" (id,"clubId","facilityId","coachId","sportId","createdById",title,"startsAt","endsAt","updatedAt")
  VALUES ('s_f','c1','f3','u_coach3','sp_padel','u_coach3','F','2030-01-01 13:00Z','2030-01-01 14:00Z',now());
-- Machine booked with 15 min setup padding before the session.
INSERT INTO "EquipmentBooking" (id,"clubId","equipmentId","sessionId",quantity,"startsAt","endsAt","updatedAt")
  VALUES ('eb7','c1','e_machine','s_f',1,'2030-01-01 12:45Z','2030-01-01 14:00Z',now());
SELECT pg_temp.expect_ok('equipment: reschedule shifts bookings and keeps padding', $q$
  UPDATE "PracticeSession" SET "startsAt"='2030-01-01 15:00Z', "endsAt"='2030-01-01 16:00Z' WHERE id='s_f';
  DO $d$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM "EquipmentBooking" WHERE id='eb7'
                   AND "startsAt"='2030-01-01 14:45Z' AND "endsAt"='2030-01-01 16:00Z') THEN
      RAISE EXCEPTION 'booking not shifted';
    END IF;
  END $d$$q$);
SELECT pg_temp.expect_violation('equipment: reschedule into conflict rejected (sync trigger)',
  $q$UPDATE "PracticeSession" SET "startsAt"='2030-01-01 10:30Z', "endsAt"='2030-01-01 11:30Z' WHERE id='s_f'$q$,
  'EquipmentBooking_capacity');
SELECT pg_temp.expect_ok('equipment: cancelling session releases units', $q$
  UPDATE "PracticeSession" SET status='CANCELLED', "cancelledAt"=now() WHERE id='s_a';
  DO $d$ BEGIN
    IF (SELECT count(*) FROM "EquipmentBooking" WHERE "sessionId"='s_a' AND status='CANCELLED') <> 2 THEN
      RAISE EXCEPTION 'bookings not released';
    END IF;
  END $d$;
  INSERT INTO "EquipmentBooking" (id,"clubId","equipmentId","sessionId",quantity,"startsAt","endsAt","updatedAt")
     VALUES ('eb6','c1','e_machine','s_e',1,'2030-01-01 10:30Z','2030-01-01 11:30Z',now())$q$);

-- Seat capacity guard (s_d has no max; set to 1)
UPDATE "PracticeSession" SET "maxParticipants" = 1 WHERE id = 's_d';
SELECT pg_temp.expect_ok('seats: first accept allowed',
  $q$INSERT INTO "SessionParticipant" (id,"sessionId","userId",status,"updatedAt") VALUES ('p1','s_d','u_s1','ACCEPTED',now())$q$);
SELECT pg_temp.expect_ok('seats: invite beyond capacity allowed',
  $q$INSERT INTO "SessionParticipant" (id,"sessionId","userId",status,"updatedAt") VALUES ('p2','s_d','u_s2','INVITED',now())$q$);
SELECT pg_temp.expect_violation('seats: accept beyond capacity rejected',
  $q$UPDATE "SessionParticipant" SET status='ACCEPTED' WHERE id='p2'$q$,
  'SessionParticipant_capacity');

-- Misc checks
SELECT pg_temp.expect_violation('social: self-follow rejected',
  $q$INSERT INTO "Follow" ("followerId","followingId") VALUES ('u_s1','u_s1')$q$, 'Follow_no_self_follow');
SELECT pg_temp.expect_violation('social: like with no target rejected',
  $q$INSERT INTO "Like" (id,"userId") VALUES ('l1','u_s1')$q$, 'Like_exactly_one_target');
SELECT pg_temp.expect_violation('billing: polymorphic owner enforced',
  $q$INSERT INTO "StripeAccount" (id,"stripeAccountId",country,"defaultCurrency","updatedAt") VALUES ('sa1','acct_1','ES','eur',now())$q$,
  'StripeAccount_exactly_one_owner');

SELECT name, CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS result FROM results;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM results WHERE NOT passed) THEN RAISE EXCEPTION 'booking guard tests failed'; END IF;
END $$;

ROLLBACK;
