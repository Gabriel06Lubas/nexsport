-- Integration test for the coach dashboard guards (drizzle/0008_coach_guards.sql)
-- and the coaching tables' CHECKs.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/db/coach_guards.test.sql
-- Everything runs in one transaction that is rolled back at the end.
BEGIN;

INSERT INTO "User" (id, email, role, "updatedAt") VALUES
  ('u_owner', 'owner@test.dev', 'CLUB_OWNER', now()),
  ('u_coach', 'coach@test.dev', 'COACH', now()),
  ('u_s1', 's1@test.dev', 'STUDENT', now());
INSERT INTO "Club" (id, slug, name, country, "ownerId", "updatedAt") VALUES
  ('c1', 'guard-test-club', 'Padel Central', 'ES', 'u_owner', now()),
  ('c2', 'guard-test-other', 'Other', 'ES', 'u_owner', now());
INSERT INTO "Sport" (id, slug, name) VALUES ('sp_padel', 'guard-test-padel', 'Padel');
INSERT INTO "Facility" (id, "clubId", name, type, "updatedAt") VALUES
  ('f1', 'c1', 'Court 1', 'PADEL_COURT', now()),
  ('f2', 'c1', 'Court 2', 'PADEL_COURT', now()),
  ('f_other', 'c2', 'Court X', 'PADEL_COURT', now());
INSERT INTO "Equipment" (id, "clubId", name, quantity, "updatedAt") VALUES
  ('e_rackets', 'c1', 'Rental rackets', 4, now());
INSERT INTO "MembershipPlan" (id, "clubId", name, kind, "priceAmount", "durationDays", "creditCount", "updatedAt") VALUES
  ('mp_10', 'c1', '10-Session Pass', 'CREDITS', 9000, 90, 10, now()),
  ('mp_other', 'c2', 'Other plan', 'UNLIMITED', 5000, 30, NULL, now());

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

-- Coach double-booking ----------------------------------------------------------
INSERT INTO "PracticeSession" (id,"clubId","facilityId","coachId","sportId","createdById",title,"startsAt","endsAt","updatedAt")
  VALUES ('s1','c1','f1','u_coach','sp_padel','u_coach','Private','2030-05-01 10:00Z','2030-05-01 11:00Z',now());
SELECT pg_temp.expect_violation('coach: overlapping session on another court rejected',
  $q$INSERT INTO "PracticeSession" (id,"clubId","facilityId","coachId","sportId","createdById",title,"startsAt","endsAt","updatedAt")
     VALUES ('s2','c1','f2','u_coach','sp_padel','u_coach','Group','2030-05-01 10:30Z','2030-05-01 11:30Z',now())$q$,
  'PracticeSession_coach_no_overlap');
SELECT pg_temp.expect_violation('coach: overlapping session at another club rejected',
  $q$INSERT INTO "PracticeSession" (id,"clubId","facilityId","coachId","sportId","createdById",title,"startsAt","endsAt","updatedAt")
     VALUES ('s3','c2','f_other','u_coach','sp_padel','u_coach','Elsewhere','2030-05-01 10:59Z','2030-05-01 12:00Z',now())$q$,
  'PracticeSession_coach_no_overlap');
SELECT pg_temp.expect_ok('coach: back-to-back session allowed',
  $q$INSERT INTO "PracticeSession" (id,"clubId","facilityId","coachId","sportId","createdById",title,"startsAt","endsAt","updatedAt")
     VALUES ('s4','c1','f2','u_coach','sp_padel','u_coach','Next','2030-05-01 11:00Z','2030-05-01 12:00Z',now())$q$);
SELECT pg_temp.expect_ok('coach: cancelling frees the coach',
  $q$UPDATE "PracticeSession" SET status = 'CANCELLED', "cancelledAt" = now() WHERE id = 's1';
     INSERT INTO "PracticeSession" (id,"clubId","facilityId","coachId","sportId","createdById",title,"startsAt","endsAt","updatedAt")
     VALUES ('s5','c1','f2','u_coach','sp_padel','u_coach','Moved','2030-05-01 10:00Z','2030-05-01 11:00Z',now())$q$);

-- Availability ------------------------------------------------------------------
SELECT pg_temp.expect_ok('availability: window allowed',
  $q$INSERT INTO "CoachAvailability" (id,"coachId","clubId","dayOfWeek","startMinute","endMinute","updatedAt") VALUES ('a1','u_coach','c1',1,1020,1200,now())$q$);
SELECT pg_temp.expect_violation('availability: overlapping window (even at another club) rejected',
  $q$INSERT INTO "CoachAvailability" (id,"coachId","clubId","dayOfWeek","startMinute","endMinute","updatedAt") VALUES ('a2','u_coach','c2',1,1140,1260,now())$q$,
  'CoachAvailability_no_overlap');
SELECT pg_temp.expect_violation('availability: facility of another club rejected',
  $q$INSERT INTO "CoachAvailability" (id,"coachId","clubId","facilityId","dayOfWeek","startMinute","endMinute","updatedAt") VALUES ('a3','u_coach','c1','f_other',2,600,720,now())$q$,
  'CoachAvailability_facilityId_clubId_fkey');
SELECT pg_temp.expect_violation('availability: off-grid window rejected',
  $q$INSERT INTO "CoachAvailability" (id,"coachId","clubId","dayOfWeek","startMinute","endMinute","updatedAt") VALUES ('a4','u_coach','c1',3,600,610,now())$q$,
  'CoachAvailability_window');

-- Profile -----------------------------------------------------------------------
SELECT pg_temp.expect_violation('profile: booking without a price rejected',
  $q$INSERT INTO "CoachProfile" ("userId",slug,"bookingEnabled","updatedAt") VALUES ('u_coach','coach-x',true,now())$q$,
  'CoachProfile_bookable');
SELECT pg_temp.expect_violation('profile: bad slug rejected',
  $q$INSERT INTO "CoachProfile" ("userId",slug,"updatedAt") VALUES ('u_coach','Coach X',now())$q$,
  'CoachProfile_slug_format');
SELECT pg_temp.expect_ok('profile: bookable profile allowed',
  $q$INSERT INTO "CoachProfile" ("userId",slug,"bookingEnabled","privateRateAmount","sportId","updatedAt") VALUES ('u_coach','coach-x',true,4000,'sp_padel',now())$q$);

-- Credit adjustments ------------------------------------------------------------
INSERT INTO "MemberPass" (id,"clubId","planId","userId","creditsTotal","startsAt","expiresAt","priceAmount",currency,"paymentMethod","updatedAt")
  VALUES ('pass1','c1','mp_10','u_s1',10,now(),now() + interval '90 days',9000,'eur','ON_SITE',now());
SELECT pg_temp.expect_ok('credits: single-credit adjustment logged',
  $q$INSERT INTO "PassCreditAdjustment" (id,"clubId","passId",delta,reason,"actorId") VALUES ('adj1','c1','pass1',1,'Attended','u_coach')$q$);
SELECT pg_temp.expect_violation('credits: bulk adjustment rejected',
  $q$INSERT INTO "PassCreditAdjustment" (id,"clubId","passId",delta,reason) VALUES ('adj2','c1','pass1',5,'Bulk')$q$,
  'PassCreditAdjustment_delta');
SELECT pg_temp.expect_violation('credits: pass of another club rejected',
  $q$INSERT INTO "PassCreditAdjustment" (id,"clubId","passId",delta,reason) VALUES ('adj3','c2','pass1',1,'Wrong club')$q$,
  'PassCreditAdjustment_passId_clubId_fkey');

SELECT name, CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS result FROM results;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM results WHERE NOT passed) THEN RAISE EXCEPTION 'coach guard tests failed'; END IF;
END $$;

ROLLBACK;
