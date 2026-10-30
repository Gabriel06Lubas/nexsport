-- Integration test for the club dashboard guards (drizzle/0006_club_guards.sql).
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/db/club_guards.test.sql
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

-- Court rentals ---------------------------------------------------------------
SELECT pg_temp.expect_ok('rental: first booking allowed',
  $q$INSERT INTO "FacilityBooking" (id,"clubId","facilityId","customerName","startsAt","endsAt","priceAmount","paymentMethod","updatedAt")
     VALUES ('b1','c1','f1','Ana','2030-05-01 18:00Z','2030-05-01 19:30Z',3000,'ON_SITE',now())$q$);
SELECT pg_temp.expect_violation('rental: overlapping rental rejected',
  $q$INSERT INTO "FacilityBooking" (id,"clubId","facilityId","customerName","startsAt","endsAt","priceAmount","paymentMethod","updatedAt")
     VALUES ('b2','c1','f1','Ben','2030-05-01 19:00Z','2030-05-01 20:00Z',2000,'ON_SITE',now())$q$,
  'FacilityBooking_no_overlap');
SELECT pg_temp.expect_ok('rental: back-to-back rental allowed',
  $q$INSERT INTO "FacilityBooking" (id,"clubId","facilityId","customerName","startsAt","endsAt","priceAmount","paymentMethod","updatedAt")
     VALUES ('b3','c1','f1','Ben','2030-05-01 19:30Z','2030-05-01 20:30Z',2000,'ON_SITE',now())$q$);
SELECT pg_temp.expect_ok('rental: same time on another court allowed',
  $q$INSERT INTO "FacilityBooking" (id,"clubId","facilityId","customerName","startsAt","endsAt","priceAmount","paymentMethod","updatedAt")
     VALUES ('b4','c1','f2','Cris','2030-05-01 18:00Z','2030-05-01 19:00Z',2000,'ON_SITE',now())$q$);
SELECT pg_temp.expect_violation('rental: session over a rental rejected',
  $q$INSERT INTO "PracticeSession" (id,"clubId","facilityId","coachId","sportId","createdById",title,"startsAt","endsAt","updatedAt")
     VALUES ('s1','c1','f1','u_coach','sp_padel','u_coach','Clinic','2030-05-01 18:30Z','2030-05-01 19:00Z',now())$q$,
  'Facility_booking_overlap');
SELECT pg_temp.expect_ok('rental: session after the rentals allowed',
  $q$INSERT INTO "PracticeSession" (id,"clubId","facilityId","coachId","sportId","createdById",title,"startsAt","endsAt","updatedAt")
     VALUES ('s2','c1','f1','u_coach','sp_padel','u_coach','Clinic','2030-05-01 21:00Z','2030-05-01 22:00Z',now())$q$);
SELECT pg_temp.expect_violation('rental: rental over a session rejected',
  $q$INSERT INTO "FacilityBooking" (id,"clubId","facilityId","customerName","startsAt","endsAt","priceAmount","paymentMethod","updatedAt")
     VALUES ('b5','c1','f1','Dan','2030-05-01 21:30Z','2030-05-01 22:30Z',2000,'ON_SITE',now())$q$,
  'Facility_booking_overlap');
SELECT pg_temp.expect_violation('rental: moving a rental onto a session rejected',
  $q$UPDATE "FacilityBooking" SET "startsAt" = '2030-05-01 20:30Z', "endsAt" = '2030-05-01 21:30Z' WHERE id = 'b3'$q$,
  'Facility_booking_overlap');
SELECT pg_temp.expect_ok('rental: cancelling frees the slot',
  $q$UPDATE "FacilityBooking" SET status = 'CANCELLED', "cancelledAt" = now() WHERE id = 'b1';
     INSERT INTO "PracticeSession" (id,"clubId","facilityId","coachId","sportId","createdById",title,"startsAt","endsAt","updatedAt")
     VALUES ('s3','c1','f1','u_coach','sp_padel','u_coach','Clinic','2030-05-01 18:00Z','2030-05-01 19:00Z',now())$q$);
SELECT pg_temp.expect_violation('rental: un-cancelling into a session rejected',
  $q$UPDATE "FacilityBooking" SET status = 'CONFIRMED', "cancelledAt" = NULL WHERE id = 'b1'$q$,
  'Facility_booking_overlap');
SELECT pg_temp.expect_violation('rental: facility of another club rejected',
  $q$INSERT INTO "FacilityBooking" (id,"clubId","facilityId","customerName","startsAt","endsAt","priceAmount","paymentMethod","updatedAt")
     VALUES ('b6','c1','f_other','Eve','2030-06-01 10:00Z','2030-06-01 11:00Z',2000,'ON_SITE',now())$q$,
  'FacilityBooking_facilityId_clubId_fkey');
SELECT pg_temp.expect_violation('rental: reversed times rejected by CHECK',
  $q$INSERT INTO "FacilityBooking" (id,"clubId","facilityId","customerName","startsAt","endsAt","priceAmount","paymentMethod","updatedAt")
     VALUES ('b7','c1','f2','Eve','2030-06-01 11:00Z','2030-06-01 10:00Z',2000,'ON_SITE',now())$q$,
  'FacilityBooking_time_order');

-- Price rules -----------------------------------------------------------------
SELECT pg_temp.expect_ok('pricing: peak window allowed',
  $q$INSERT INTO "FacilityPriceRule" (id,"clubId","facilityId","dayOfWeek","startMinute","endMinute",tier,"hourlyRateAmount","updatedAt")
     VALUES ('r1','c1','f1',1,1080,1320,'PEAK',3200,now())$q$);
SELECT pg_temp.expect_ok('pricing: touching window allowed',
  $q$INSERT INTO "FacilityPriceRule" (id,"clubId","facilityId","dayOfWeek","startMinute","endMinute",tier,"hourlyRateAmount","updatedAt")
     VALUES ('r2','c1','f1',1,420,1080,'OFF_PEAK',1800,now())$q$);
SELECT pg_temp.expect_violation('pricing: overlapping window rejected',
  $q$INSERT INTO "FacilityPriceRule" (id,"clubId","facilityId","dayOfWeek","startMinute","endMinute",tier,"hourlyRateAmount","updatedAt")
     VALUES ('r3','c1','f1',1,1200,1260,'PEAK',4000,now())$q$,
  'FacilityPriceRule_no_overlap');
SELECT pg_temp.expect_ok('pricing: same window on another day allowed',
  $q$INSERT INTO "FacilityPriceRule" (id,"clubId","facilityId","dayOfWeek","startMinute","endMinute",tier,"hourlyRateAmount","updatedAt")
     VALUES ('r4','c1','f1',2,1200,1260,'PEAK',4000,now())$q$);
SELECT pg_temp.expect_violation('pricing: off-grid minute rejected',
  $q$INSERT INTO "FacilityPriceRule" (id,"clubId","facilityId","dayOfWeek","startMinute","endMinute",tier,"hourlyRateAmount","updatedAt")
     VALUES ('r5','c1','f2',3,600,610,'PEAK',4000,now())$q$,
  'FacilityPriceRule_window');

-- Equipment maintenance -----------------------------------------------------
INSERT INTO "PracticeSession" (id,"clubId","facilityId","coachId","sportId","createdById",title,"startsAt","endsAt","updatedAt")
  VALUES ('s_eq','c1','f2','u_coach','sp_padel','u_coach','Eq','2030-07-01 10:00Z','2030-07-01 11:00Z',now());
SELECT pg_temp.expect_ok('maintenance: 1 of 4 rackets to repair',
  $q$INSERT INTO "EquipmentMaintenance" (id,"clubId","equipmentId",quantity,reason,"updatedAt") VALUES ('m1','c1','e_rackets',1,'Broken frame',now())$q$);
SELECT pg_temp.expect_violation('maintenance: more units than exist rejected',
  $q$INSERT INTO "EquipmentMaintenance" (id,"clubId","equipmentId",quantity,reason,"updatedAt") VALUES ('m2','c1','e_rackets',4,'All broken',now())$q$,
  'EquipmentMaintenance_capacity');
SELECT pg_temp.expect_violation('maintenance: units in repair are not bookable',
  $q$INSERT INTO "EquipmentBooking" (id,"clubId","equipmentId","sessionId",quantity,"startsAt","endsAt","updatedAt")
     VALUES ('eb1','c1','e_rackets','s_eq',4,'2030-07-01 10:00Z','2030-07-01 11:00Z',now())$q$,
  'EquipmentBooking_capacity');
SELECT pg_temp.expect_ok('maintenance: remaining units bookable',
  $q$INSERT INTO "EquipmentBooking" (id,"clubId","equipmentId","sessionId",quantity,"startsAt","endsAt","updatedAt")
     VALUES ('eb2','c1','e_rackets','s_eq',3,'2030-07-01 10:00Z','2030-07-01 11:00Z',now())$q$);
SELECT pg_temp.expect_violation('maintenance: stock cut below repairs + reservations rejected',
  $q$UPDATE "Equipment" SET quantity = 3 WHERE id = 'e_rackets'$q$,
  'EquipmentBooking_capacity');
SELECT pg_temp.expect_ok('maintenance: resolving returns the unit',
  $q$UPDATE "EquipmentMaintenance" SET "resolvedAt" = now() WHERE id = 'm1';
     UPDATE "Equipment" SET quantity = 3 WHERE id = 'e_rackets'$q$);

-- Memberships & payments ----------------------------------------------------
SELECT pg_temp.expect_ok('pass: sold from a plan',
  $q$INSERT INTO "MemberPass" (id,"clubId","planId","userId","creditsTotal","startsAt","expiresAt","priceAmount",currency,"paymentMethod","updatedAt")
     VALUES ('pass1','c1','mp_10','u_s1',10,now(),now() + interval '90 days',9000,'eur','ON_SITE',now())$q$);
SELECT pg_temp.expect_violation('pass: plan of another club rejected',
  $q$INSERT INTO "MemberPass" (id,"clubId","planId","userId","startsAt","expiresAt","priceAmount",currency,"paymentMethod","updatedAt")
     VALUES ('pass2','c1','mp_other','u_s1',now(),now() + interval '30 days',5000,'eur','ON_SITE',now())$q$,
  'MemberPass_planId_clubId_fkey');
SELECT pg_temp.expect_violation('pass: using more credits than bought rejected',
  $q$UPDATE "MemberPass" SET "creditsUsed" = 11 WHERE id = 'pass1'$q$, 'MemberPass_credits');
SELECT pg_temp.expect_violation('plan: credits plan without credits rejected',
  $q$INSERT INTO "MembershipPlan" (id,"clubId",name,kind,"priceAmount","durationDays","updatedAt") VALUES ('mp_bad','c1','Bad','CREDITS',100,30,now())$q$,
  'MembershipPlan_credits_match_kind');
SELECT pg_temp.expect_ok('payment: membership payment allowed',
  $q$INSERT INTO "PaymentTransaction" (id,"clubId",kind,"memberPassId","payerId",amount,currency,status,"stripePaymentIntentId","transferGroup","idempotencyKey","updatedAt")
     VALUES ('pay1','c1','MEMBERSHIP','pass1','u_s1',9000,'eur','SUCCEEDED','pi_1','g1','k1',now())$q$);
SELECT pg_temp.expect_violation('payment: second live payment for a pass rejected',
  $q$INSERT INTO "PaymentTransaction" (id,"clubId",kind,"memberPassId","payerId",amount,currency,status,"stripePaymentIntentId","transferGroup","idempotencyKey","updatedAt")
     VALUES ('pay2','c1','MEMBERSHIP','pass1','u_s1',9000,'eur','PROCESSING','pi_2','g2','k2',now())$q$,
  'PaymentTransaction_one_live_per_member_pass');
SELECT pg_temp.expect_violation('payment: kind must match its target',
  $q$INSERT INTO "PaymentTransaction" (id,"clubId",kind,"memberPassId","payerId",amount,currency,"stripePaymentIntentId","transferGroup","idempotencyKey","updatedAt")
     VALUES ('pay3','c1','COURT_RENTAL','pass1','u_s1',9000,'eur','pi_3','g3','k3',now())$q$,
  'PaymentTransaction_kind_target');
SELECT pg_temp.expect_violation('payment: rental of another club rejected',
  $q$INSERT INTO "PaymentTransaction" (id,"clubId",kind,"facilityBookingId","payerId",amount,currency,"stripePaymentIntentId","transferGroup","idempotencyKey","updatedAt")
     VALUES ('pay4','c2','COURT_RENTAL','b4','u_s1',2000,'eur','pi_4','g4','k4',now())$q$,
  'PaymentTransaction_facilityBookingId_clubId_fkey');

SELECT name, CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS result FROM results;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM results WHERE NOT passed) THEN RAISE EXCEPTION 'club guard tests failed'; END IF;
END $$;

ROLLBACK;
