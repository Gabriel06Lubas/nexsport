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
  -- Paid onboarding: what the Stripe webhook provisions from, and one live plan each.
  ('PlanCheckout: kind decides which fields are required', pg_temp.has_constraint('PlanCheckout', 'PlanCheckout_kind_shape', 'c')),
  ('PlanCheckout: one open checkout per reserved club address', pg_temp.has_index('PlanCheckout', 'PlanCheckout_open_slug_key', true, '%("clubSlug") WHERE%')),
  ('PlanCheckout: a Stripe Checkout Session provisions once', pg_temp.has_index('PlanCheckout', 'PlanCheckout_stripeCheckoutSessionId_key', true, '%("stripeCheckoutSessionId")%')),
  ('Subscription: one live subscription per club', pg_temp.has_index('Subscription', 'Subscription_one_live_per_club', true, '%("clubId") WHERE%')),
  ('Subscription: one live subscription per user', pg_temp.has_index('Subscription', 'Subscription_one_live_per_user', true, '%("userId") WHERE%')),
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

-- PlanCheckout rows that couldn't be provisioned safely are refused.
INSERT INTO "User"(id, email, role, "updatedAt") VALUES ('contract_buyer', 'contract-buyer@example.test', 'STUDENT', now());
DO $$
BEGIN
  BEGIN
    INSERT INTO "PlanCheckout"(id, "userId", kind, tier, "updatedAt") VALUES ('pc1', 'contract_buyer', 'CLUB_SIGNUP', 'CLUB_BASIC', now());
    INSERT INTO results VALUES ('CLUB_SIGNUP without the club''s details is refused', false);
  EXCEPTION WHEN check_violation THEN INSERT INTO results VALUES ('CLUB_SIGNUP without the club''s details is refused', true);
  END;
  BEGIN
    INSERT INTO "PlanCheckout"(id, "userId", kind, tier, "updatedAt") VALUES ('pc2', 'contract_buyer', 'COACH_PRO', 'CLUB_ENTERPRISE', now());
    INSERT INTO results VALUES ('COACH_PRO can only buy PRO_COACH', false);
  EXCEPTION WHEN check_violation THEN INSERT INTO results VALUES ('COACH_PRO can only buy PRO_COACH', true);
  END;
  BEGIN
    INSERT INTO "PlanCheckout"(id, "userId", kind, tier, "clubName", "clubSlug", country, timezone, currency, "updatedAt")
      VALUES ('pc3', 'contract_buyer', 'CLUB_SIGNUP', 'PRO_COACH', 'X', 'x-club', 'ES', 'Europe/Madrid', 'eur', now());
    INSERT INTO results VALUES ('CLUB_SIGNUP can only buy a club plan', false);
  EXCEPTION WHEN check_violation THEN INSERT INTO results VALUES ('CLUB_SIGNUP can only buy a club plan', true);
  END;
END $$;

-- Every foreign key has an index on its leading column (a parent delete or
-- re-key would otherwise scan the referencing table under lock).
INSERT INTO results
SELECT 'FK index: ' || c.conrelid::regclass || '.' || a.attname, false
  FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
 WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
   AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid AND i.indkey[0] = c.conkey[1]);
INSERT INTO results VALUES ('every foreign key has an index on its leading column', true);

-- updatedAt: a default and the touch trigger on every table that has it.
INSERT INTO results
SELECT 'updatedAt default and trigger: ' || c.relname, false
  FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'updatedAt' AND NOT a.attisdropped
 WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
   AND (NOT a.atthasdef OR NOT pg_temp.has_trigger(c.relname, c.relname || '_touch_updated_at'));
INSERT INTO results VALUES ('every updatedAt column has a default and the touch trigger', true);

-- Same-club composite foreign keys.
INSERT INTO results
SELECT 'same-club FK: ' || n, pg_temp.has_constraint(split_part(n, '_', 1), n, 'f')
  FROM unnest(ARRAY[
    'CoachAssignment_coachMemberId_same_club_fkey', 'CoachAssignment_studentMemberId_same_club_fkey', 'CoachAssignment_ageGroupId_same_club_fkey',
    'ClubMember_ageGroupId_same_club_fkey', 'PracticeSession_ageGroupId_same_club_fkey', 'PracticeSession_cancellationPolicyId_same_club_fkey',
    'PaymentTransaction_cancellationPolicyId_same_club_fkey', 'PaymentTransaction_sessionId_same_club_fkey', 'PassCreditAdjustment_sessionId_same_club_fkey']) n;

-- Behaviour: cross-club references refused; SET NULL clears only the key; updatedAt moves on raw UPDATEs; holds need an expiry.
INSERT INTO "User"(id, email, role, "updatedAt") VALUES ('contract_owner', 'contract-owner@example.test', 'CLUB_OWNER', now());
INSERT INTO "Club"(id, slug, name, country, "ownerId", "updatedAt") VALUES
  ('contract_club_a', 'contract-club-a', 'A', 'ES', 'contract_owner', now() - interval '1 day'),
  ('contract_club_b', 'contract-club-b', 'B', 'ES', 'contract_owner', now());
INSERT INTO "ClubMember"(id, "clubId", "userId", role, status, "updatedAt") VALUES
  ('contract_coach_a', 'contract_club_a', 'contract_owner', 'COACH', 'ACTIVE', now()),
  ('contract_student_b', 'contract_club_b', 'contract_owner', 'STUDENT', 'ACTIVE', now());
INSERT INTO "AgeGroup"(id, "clubId", name, "updatedAt") VALUES ('contract_u12', 'contract_club_a', 'U12', now());
INSERT INTO "ClubMember"(id, "clubId", "userId", role, status, "ageGroupId", "updatedAt") VALUES ('contract_student_a', 'contract_club_a', 'contract_owner', 'STUDENT', 'ACTIVE', 'contract_u12', now());
INSERT INTO "Facility"(id, "clubId", name, type, "updatedAt") VALUES ('contract_court', 'contract_club_a', 'Court', 'PADEL_COURT', now());
DO $$
BEGIN
  BEGIN
    INSERT INTO "CoachAssignment"(id, "clubId", "coachMemberId", "studentMemberId", "startsOn")
      VALUES ('contract_ca', 'contract_club_a', 'contract_coach_a', 'contract_student_b', current_date);
    INSERT INTO results VALUES ('a coach assignment can''t pair members of two clubs', false);
  EXCEPTION WHEN foreign_key_violation THEN INSERT INTO results VALUES ('a coach assignment can''t pair members of two clubs', true);
  END;
  BEGIN
    INSERT INTO "FacilityBooking"(id, "clubId", "facilityId", "startsAt", "endsAt", status, "priceAmount", "paymentMethod", "updatedAt")
      VALUES ('contract_hold', 'contract_club_a', 'contract_court', now() + interval '1 day', now() + interval '1 day 1 hour', 'PENDING', 2000, 'ONLINE', now());
    INSERT INTO results VALUES ('a PENDING booking needs holdExpiresAt', false);
  EXCEPTION WHEN check_violation THEN INSERT INTO results VALUES ('a PENDING booking needs holdExpiresAt', true);
  END;
END $$;
DELETE FROM "AgeGroup" WHERE id = 'contract_u12';
INSERT INTO results SELECT 'deleting an age group clears ageGroupId but keeps clubId', "ageGroupId" IS NULL AND "clubId" = 'contract_club_a' FROM "ClubMember" WHERE id = 'contract_student_a';
UPDATE "Club" SET name = 'A renamed' WHERE id = 'contract_club_a';
INSERT INTO results SELECT 'a raw UPDATE refreshes updatedAt', "updatedAt" > now() - interval '1 minute' FROM "Club" WHERE id = 'contract_club_a';

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
