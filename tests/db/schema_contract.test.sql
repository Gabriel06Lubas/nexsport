-- Schema contract for booking and payments: every index, constraint and
-- trigger the booking action and the Stripe webhook rely on for speed and for
-- race-freedom. Fails loudly if a migration drops or renames one.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/db/schema_contract.test.sql
BEGIN;

CREATE TEMP TABLE results (name text, passed boolean);

CREATE FUNCTION pg_temp.has_constraint(p_table text, p_name text, p_type "char") RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
                  WHERE t.relname = p_table AND c.conname = p_name AND c.contype = p_type)
$$;
CREATE FUNCTION pg_temp.has_index(p_table text, p_name text, p_unique boolean, p_def_like text) RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM pg_indexes i JOIN pg_class c ON c.relname = i.indexname JOIN pg_index x ON x.indexrelid = c.oid
                  WHERE i.tablename = p_table AND i.indexname = p_name AND x.indisunique = p_unique AND i.indexdef LIKE p_def_like)
$$;
CREATE FUNCTION pg_temp.has_trigger(p_table text, p_name text) RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM pg_trigger g JOIN pg_class t ON t.oid = g.tgrelid WHERE t.relname = p_table AND g.tgname = p_name AND NOT g.tgisinternal)
$$;

INSERT INTO results VALUES
  -- No double-booking, enforced atomically by the database (x = exclusion constraint).
  ('btree_gist extension installed', EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist')),
  ('PracticeSession: no two sessions overlap on a facility', pg_temp.has_constraint('PracticeSession', 'PracticeSession_facility_no_overlap', 'x')),
  ('PracticeSession: a coach is never in two sessions at once', pg_temp.has_constraint('PracticeSession', 'PracticeSession_coach_no_overlap', 'x')),
  ('FacilityBooking: no two rentals (pending or confirmed) overlap', pg_temp.has_constraint('FacilityBooking', 'FacilityBooking_no_overlap', 'x')),
  ('FacilityBooking ↔ PracticeSession cross-table guard (rental side)', pg_temp.has_trigger('FacilityBooking', 'FacilityBooking_session_overlap_guard')),
  ('FacilityBooking ↔ PracticeSession cross-table guard (session side)', pg_temp.has_trigger('PracticeSession', 'PracticeSession_rental_overlap_guard')),
  ('exclusion constraints skip cancelled rows only',
    (SELECT pg_get_constraintdef(oid) LIKE '%WHERE ((status <> ''CANCELLED''%' FROM pg_constraint WHERE conname = 'FacilityBooking_no_overlap')),
  -- Range lookups by facility and time (schedules, availability, the friendly pre-check).
  ('PracticeSession (facilityId, startsAt) index', pg_temp.has_index('PracticeSession', 'PracticeSession_facilityId_startsAt_idx', false, '%("facilityId", "startsAt")%')),
  ('FacilityBooking (facilityId, startsAt) index', pg_temp.has_index('FacilityBooking', 'FacilityBooking_facilityId_startsAt_idx', false, '%("facilityId", "startsAt")%')),
  ('a facility belongs to the booking''s club (composite FK)', pg_temp.has_constraint('FacilityBooking', 'FacilityBooking_facilityId_clubId_fkey', 'f')),
  -- Stripe Connect accounts: one per club / coach, found by club in one index probe.
  ('StripeAccount unique per club', pg_temp.has_index('StripeAccount', 'StripeAccount_clubId_key', true, '%("clubId")%')),
  ('StripeAccount unique per coach', pg_temp.has_index('StripeAccount', 'StripeAccount_userId_key', true, '%("userId")%')),
  ('StripeAccount acct_ id unique', pg_temp.has_index('StripeAccount', 'StripeAccount_stripeAccountId_key', true, '%("stripeAccountId")%')),
  ('StripeAccount has exactly one owner', pg_temp.has_constraint('StripeAccount', 'StripeAccount_exactly_one_owner', 'c')),
  -- Payments: idempotency and webhook lookups.
  ('PaymentTransaction pi_ id unique (webhook lookup)', pg_temp.has_index('PaymentTransaction', 'PaymentTransaction_stripePaymentIntentId_key', true, '%("stripePaymentIntentId")%')),
  ('PaymentTransaction cs_ id unique (webhook lookup)', pg_temp.has_index('PaymentTransaction', 'PaymentTransaction_stripeCheckoutSessionId_key', true, '%("stripeCheckoutSessionId")%')),
  ('PaymentTransaction idempotency key unique', pg_temp.has_index('PaymentTransaction', 'PaymentTransaction_idempotencyKey_key', true, '%("idempotencyKey")%')),
  ('one live payment per court booking', pg_temp.has_index('PaymentTransaction', 'PaymentTransaction_one_live_per_facility_booking', true, '%WHERE%')),
  ('one live payment per session seat', pg_temp.has_index('PaymentTransaction', 'PaymentTransaction_one_live_per_participant', true, '%WHERE%')),
  ('payments by status (open holds are a small slice)', pg_temp.has_index('PaymentTransaction', 'PaymentTransaction_status_idx', false, '%(status)%')),
  ('a payment targets exactly what its kind says', pg_temp.has_constraint('PaymentTransaction', 'PaymentTransaction_kind_target', 'c')),
  ('platform fee never exceeds the amount', pg_temp.has_constraint('PaymentTransaction', 'PaymentTransaction_fee_bounds', 'c')),
  ('one transfer per payment and recipient', pg_temp.has_index('PaymentTransfer', 'PaymentTransfer_paymentId_recipientType_key', true, '%')),
  ('webhook events stored once by evt_ id', pg_temp.has_constraint('StripeWebhookEvent', 'StripeWebhookEvent_pkey', 'p'));

-- The planner can answer the overlap pre-check from an index, not a scan.
SET LOCAL enable_seqscan = off;
DO $$
DECLARE plan text;
BEGIN
  EXECUTE $q$EXPLAIN SELECT id FROM "FacilityBooking"
             WHERE "facilityId" = 'f' AND status <> 'CANCELLED' AND "startsAt" < now() + interval '1 hour' AND "endsAt" > now()$q$ INTO plan;
  INSERT INTO results VALUES ('overlap pre-check uses an index on FacilityBooking', plan ILIKE '%Index%');
  EXECUTE $q$EXPLAIN SELECT id FROM "PaymentTransaction" WHERE status = 'REQUIRES_PAYMENT_METHOD' AND "checkoutExpiresAt" < now()$q$ INTO plan;
  INSERT INTO results VALUES ('hold sweeper uses the status index', plan LIKE '%PaymentTransaction_status_idx%');
  EXECUTE $q$EXPLAIN SELECT id FROM "StripeAccount" WHERE "clubId" = 'c'$q$ INTO plan;
  INSERT INTO results VALUES ('Connect account lookup by club uses its unique index', plan LIKE '%StripeAccount_clubId_key%');
END $$;

SELECT name, CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS result FROM results;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM results WHERE passed IS NOT TRUE) THEN RAISE EXCEPTION 'schema contract tests failed'; END IF;
END $$;

ROLLBACK;
