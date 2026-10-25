-- =============================================================================
-- nexport — integrity guards Prisma's schema language cannot express.
--
-- Contents
--   1. Extensions
--   2. CHECK constraints (value ranges, polymorphic "exactly one owner" rules)
--   3. Partial unique indexes
--   4. Facility double-booking guard   (GiST exclusion constraint)
--   5. Equipment over-allocation guard (row-locking trigger)
--   6. Session seat-capacity guard     (row-locking trigger)
--   7. Session → equipment booking sync (reschedule / cancel cascade)
--
-- Every guard raises SQLSTATE 23P01 (exclusion_violation) with a stable
-- constraint name so the app maps them to one domain error:
--   "PracticeSession_facility_no_overlap"
--   "EquipmentBooking_capacity"
--   "SessionParticipant_capacity"
-- =============================================================================

-- 1. EXTENSIONS ---------------------------------------------------------------
-- btree_gist lets a GiST index combine scalar equality (facilityId =) with
-- range overlap (tstzrange &&) inside a single exclusion constraint.
CREATE EXTENSION IF NOT EXISTS btree_gist;


-- 2. CHECK CONSTRAINTS --------------------------------------------------------

-- Identity / social
ALTER TABLE "Profile"
  ADD CONSTRAINT "Profile_handle_format" CHECK ("handle" ~ '^[a-z0-9_.]{3,30}$'),
  ADD CONSTRAINT "Profile_counters_non_negative"
    CHECK ("followerCount" >= 0 AND "followingCount" >= 0 AND "postCount" >= 0);

ALTER TABLE "Follow"
  ADD CONSTRAINT "Follow_no_self_follow" CHECK ("followerId" <> "followingId");

ALTER TABLE "Post"
  ADD CONSTRAINT "Post_counters_non_negative" CHECK ("likeCount" >= 0 AND "commentCount" >= 0);

ALTER TABLE "Comment"
  ADD CONSTRAINT "Comment_likeCount_non_negative" CHECK ("likeCount" >= 0),
  ADD CONSTRAINT "Comment_no_self_parent" CHECK ("parentId" IS NULL OR "parentId" <> "id");

ALTER TABLE "Like"
  ADD CONSTRAINT "Like_exactly_one_target" CHECK (num_nonnulls("postId", "commentId") = 1);

ALTER TABLE "Conversation"
  ADD CONSTRAINT "Conversation_direct_has_key"
    CHECK ("type" <> 'DIRECT' OR "directKey" IS NOT NULL);

-- Organisation & assets
ALTER TABLE "Club"
  ADD CONSTRAINT "Club_slug_format" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  ADD CONSTRAINT "Club_currency_format" CHECK ("currency" ~ '^[a-z]{3}$');

ALTER TABLE "AgeGroup"
  ADD CONSTRAINT "AgeGroup_age_bounds"
    CHECK (("minAge" IS NULL OR "minAge" >= 0)
       AND ("maxAge" IS NULL OR "maxAge" >= 0)
       AND ("minAge" IS NULL OR "maxAge" IS NULL OR "minAge" <= "maxAge"));

ALTER TABLE "CoachAssignment"
  ADD CONSTRAINT "CoachAssignment_has_target"
    CHECK ("studentMemberId" IS NOT NULL OR "ageGroupId" IS NOT NULL),
  ADD CONSTRAINT "CoachAssignment_date_order"
    CHECK ("endsOn" IS NULL OR "endsOn" >= "startsOn");

ALTER TABLE "Facility"
  ADD CONSTRAINT "Facility_capacity_positive" CHECK ("capacity" IS NULL OR "capacity" > 0),
  ADD CONSTRAINT "Facility_buffer_non_negative" CHECK ("bufferMinutes" >= 0),
  ADD CONSTRAINT "Facility_rate_non_negative" CHECK ("hourlyRateAmount" IS NULL OR "hourlyRateAmount" >= 0);

ALTER TABLE "Equipment"
  ADD CONSTRAINT "Equipment_quantity_non_negative" CHECK ("quantity" >= 0);

ALTER TABLE "EquipmentBooking"
  ADD CONSTRAINT "EquipmentBooking_quantity_positive" CHECK ("quantity" > 0),
  ADD CONSTRAINT "EquipmentBooking_time_order" CHECK ("endsAt" > "startsAt");

-- Scheduling
ALTER TABLE "PracticeSession"
  ADD CONSTRAINT "PracticeSession_time_order" CHECK ("endsAt" > "startsAt"),
  ADD CONSTRAINT "PracticeSession_price_non_negative" CHECK ("priceAmount" >= 0),
  ADD CONSTRAINT "PracticeSession_currency_format" CHECK ("currency" ~ '^[a-z]{3}$'),
  ADD CONSTRAINT "PracticeSession_coach_share_bps" CHECK ("coachShareBps" BETWEEN 0 AND 10000),
  ADD CONSTRAINT "PracticeSession_max_participants_positive"
    CHECK ("maxParticipants" IS NULL OR "maxParticipants" > 0),
  ADD CONSTRAINT "PracticeSession_cancellation_consistent"
    CHECK (("status" = 'CANCELLED') = ("cancelledAt" IS NOT NULL));

ALTER TABLE "Attendance"
  ADD CONSTRAINT "Attendance_rating_range"
    CHECK ("performanceRating" IS NULL OR "performanceRating" BETWEEN 1 AND 5);

-- Billing
ALTER TABLE "Subscription"
  ADD CONSTRAINT "Subscription_exactly_one_owner" CHECK (num_nonnulls("clubId", "userId") = 1),
  ADD CONSTRAINT "Subscription_fee_bps" CHECK ("platformFeeBps" BETWEEN 0 AND 10000),
  ADD CONSTRAINT "Subscription_period_order" CHECK ("currentPeriodEnd" >= "currentPeriodStart");

ALTER TABLE "StripeAccount"
  ADD CONSTRAINT "StripeAccount_exactly_one_owner" CHECK (num_nonnulls("clubId", "userId") = 1);

ALTER TABLE "PaymentTransaction"
  ADD CONSTRAINT "PaymentTransaction_amount_positive" CHECK ("amount" > 0),
  ADD CONSTRAINT "PaymentTransaction_currency_format" CHECK ("currency" ~ '^[a-z]{3}$'),
  ADD CONSTRAINT "PaymentTransaction_fee_bounds"
    CHECK ("applicationFeeAmount" >= 0 AND "applicationFeeAmount" <= "amount"),
  ADD CONSTRAINT "PaymentTransaction_stripe_fee_non_negative"
    CHECK ("stripeFeeAmount" IS NULL OR "stripeFeeAmount" >= 0),
  ADD CONSTRAINT "PaymentTransaction_refund_bounds"
    CHECK ("refundedAmount" >= 0 AND "refundedAmount" <= "amount"),
  ADD CONSTRAINT "PaymentTransaction_refund_percent"
    CHECK ("appliedRefundPercent" IS NULL OR "appliedRefundPercent" BETWEEN 0 AND 100),
  ADD CONSTRAINT "PaymentTransaction_dispute_amount"
    CHECK ("disputedAmount" IS NULL OR ("disputedAmount" > 0 AND "disputedAmount" <= "amount"));

ALTER TABLE "PaymentTransfer"
  ADD CONSTRAINT "PaymentTransfer_amount_positive" CHECK ("amount" > 0),
  ADD CONSTRAINT "PaymentTransfer_reversal_bounds"
    CHECK ("reversedAmount" >= 0 AND "reversedAmount" <= "amount");

ALTER TABLE "CancellationPolicy"
  ADD CONSTRAINT "CancellationPolicy_organizer_refund_percent"
    CHECK ("organizerCancelRefundPercent" BETWEEN 0 AND 100);

ALTER TABLE "CancellationPolicyRule"
  ADD CONSTRAINT "CancellationPolicyRule_hours_non_negative" CHECK ("minHoursBeforeStart" >= 0),
  ADD CONSTRAINT "CancellationPolicyRule_percent_range" CHECK ("refundPercent" BETWEEN 0 AND 100);


-- 3. PARTIAL UNIQUE INDEXES ---------------------------------------------------

-- At most one default cancellation policy per club.
CREATE UNIQUE INDEX "CancellationPolicy_one_default_per_club"
  ON "CancellationPolicy" ("clubId") WHERE "isDefault";

-- At most one live SaaS subscription per owner (club or coach).
CREATE UNIQUE INDEX "Subscription_one_live_per_club"
  ON "Subscription" ("clubId")
  WHERE "clubId" IS NOT NULL AND "status" NOT IN ('CANCELED', 'INCOMPLETE_EXPIRED');
CREATE UNIQUE INDEX "Subscription_one_live_per_user"
  ON "Subscription" ("userId")
  WHERE "userId" IS NOT NULL AND "status" NOT IN ('CANCELED', 'INCOMPLETE_EXPIRED');

-- A session seat can have at most one in-flight or successful payment,
-- so a retried checkout can never charge the student twice.
CREATE UNIQUE INDEX "PaymentTransaction_one_live_per_participant"
  ON "PaymentTransaction" ("participantId")
  WHERE "status" NOT IN ('CANCELED', 'FAILED');

-- Unread-badge query: WHERE "recipientId" = $1 AND "readAt" IS NULL.
CREATE INDEX "Notification_unread_by_recipient"
  ON "Notification" ("recipientId", "createdAt" DESC) WHERE "readAt" IS NULL;


-- 4. FACILITY DOUBLE-BOOKING GUARD -------------------------------------------
-- Two non-cancelled sessions may not overlap on the same facility.
-- '[)' = half-open interval, so 10:00–11:00 and 11:00–12:00 do NOT conflict.
-- Enforced atomically by the database: concurrent inserts racing for the same
-- slot are serialised on the GiST index, and the loser gets SQLSTATE 23P01.
ALTER TABLE "PracticeSession"
  ADD CONSTRAINT "PracticeSession_facility_no_overlap"
  EXCLUDE USING gist (
    "facilityId" WITH =,
    tstzrange("startsAt", "endsAt", '[)') WITH &&
  ) WHERE ("status" <> 'CANCELLED');


-- 5. EQUIPMENT OVER-ALLOCATION GUARD -----------------------------------------
-- Equipment is quantity-based (40 balls, 1 ball machine), so a plain exclusion
-- constraint is not enough: we need SUM(overlapping quantity) <= stock.
-- The trigger row-locks the Equipment row, which serialises every concurrent
-- booking of that item. Under READ COMMITTED each waiter then re-reads the
-- committed bookings; under REPEATABLE READ / SERIALIZABLE it gets a
-- serialization failure (40001) to retry. Either way two transactions can
-- never both take the last unit.
CREATE OR REPLACE FUNCTION nexport_equipment_booking_capacity_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_stock     integer;
  v_active    boolean;
  v_condition "EquipmentCondition";
  v_reserved  integer;
BEGIN
  -- Releasing units never needs a check.
  IF NEW."status" NOT IN ('RESERVED', 'CHECKED_OUT') THEN
    RETURN NEW;
  END IF;

  -- A no-op UPDATE (not SELECT ... FOR UPDATE) so that under REPEATABLE READ
  -- a concurrent booker fails with a serialization error instead of reading
  -- a stale snapshot. Only "updatedAt" is SET, so no Equipment trigger fires.
  UPDATE "Equipment" SET "updatedAt" = "updatedAt"
   WHERE "id" = NEW."equipmentId"
  RETURNING "quantity", "isActive", "condition"
       INTO v_stock, v_active, v_condition;

  IF NOT FOUND THEN
    RETURN NEW; -- FK constraint will report the real error.
  END IF;

  IF NOT v_active OR v_condition IN ('RETIRED', 'NEEDS_REPAIR') THEN
    RAISE EXCEPTION 'Equipment % is not available for booking', NEW."equipmentId"
      USING ERRCODE = 'exclusion_violation',
            CONSTRAINT = 'EquipmentBooking_capacity';
  END IF;

  SELECT COALESCE(SUM(b."quantity"), 0)
    INTO v_reserved
    FROM "EquipmentBooking" b
   WHERE b."equipmentId" = NEW."equipmentId"
     AND b."id" <> NEW."id"
     AND b."status" IN ('RESERVED', 'CHECKED_OUT')
     AND tstzrange(b."startsAt", b."endsAt", '[)') && tstzrange(NEW."startsAt", NEW."endsAt", '[)');

  IF v_reserved + NEW."quantity" > v_stock THEN
    RAISE EXCEPTION 'Equipment % over-allocated: requested %, available % of %',
      NEW."equipmentId", NEW."quantity", GREATEST(v_stock - v_reserved, 0), v_stock
      USING ERRCODE = 'exclusion_violation',
            CONSTRAINT = 'EquipmentBooking_capacity';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "EquipmentBooking_capacity_guard"
  BEFORE INSERT OR UPDATE OF "equipmentId", "quantity", "startsAt", "endsAt", "status"
  ON "EquipmentBooking"
  FOR EACH ROW EXECUTE FUNCTION nexport_equipment_booking_capacity_guard();

-- Stock reductions must not strand existing reservations.
CREATE OR REPLACE FUNCTION nexport_equipment_stock_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_peak integer;
BEGIN
  IF NEW."quantity" >= OLD."quantity" THEN
    RETURN NEW;
  END IF;

  -- Peak concurrent usage among future/ongoing bookings: for each booking
  -- start point, sum every active booking that overlaps it.
  SELECT COALESCE(MAX(load), 0) INTO v_peak
    FROM (
      SELECT SUM(b2."quantity") AS load
        FROM "EquipmentBooking" b1
        JOIN "EquipmentBooking" b2
          ON b2."equipmentId" = b1."equipmentId"
         AND b2."status" IN ('RESERVED', 'CHECKED_OUT')
         AND b2."startsAt" <= b1."startsAt" AND b2."endsAt" > b1."startsAt"
       WHERE b1."equipmentId" = NEW."id"
         AND b1."status" IN ('RESERVED', 'CHECKED_OUT')
         AND b1."endsAt" > now()
       GROUP BY b1."id"
    ) peaks;

  IF v_peak > NEW."quantity" THEN
    RAISE EXCEPTION 'Cannot reduce equipment % stock to %: % units already reserved at peak',
      NEW."id", NEW."quantity", v_peak
      USING ERRCODE = 'exclusion_violation',
            CONSTRAINT = 'EquipmentBooking_capacity';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "Equipment_stock_guard"
  BEFORE UPDATE OF "quantity" ON "Equipment"
  FOR EACH ROW EXECUTE FUNCTION nexport_equipment_stock_guard();


-- 6. SESSION SEAT-CAPACITY GUARD ---------------------------------------------
-- ACCEPTED participants may never exceed PracticeSession.maxParticipants.
-- Same pattern as equipment: lock the parent row, then count.
CREATE OR REPLACE FUNCTION nexport_session_participant_capacity_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_max      integer;
  v_status   "SessionStatus";
  v_accepted integer;
BEGIN
  IF NEW."status" <> 'ACCEPTED' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."status" = 'ACCEPTED' AND OLD."sessionId" = NEW."sessionId" THEN
    RETURN NEW; -- seat already held
  END IF;

  -- No-op UPDATE as the lock — see the equipment guard for why.
  UPDATE "PracticeSession" SET "updatedAt" = "updatedAt"
   WHERE "id" = NEW."sessionId"
  RETURNING "maxParticipants", "status"
       INTO v_max, v_status;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF v_status IN ('CANCELLED', 'COMPLETED') THEN
    RAISE EXCEPTION 'Session % is % and cannot accept participants', NEW."sessionId", v_status
      USING ERRCODE = 'exclusion_violation',
            CONSTRAINT = 'SessionParticipant_capacity';
  END IF;

  IF v_max IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_accepted
    FROM "SessionParticipant"
   WHERE "sessionId" = NEW."sessionId"
     AND "status" = 'ACCEPTED'
     AND "id" <> NEW."id";

  IF v_accepted >= v_max THEN
    RAISE EXCEPTION 'Session % is full (% / %)', NEW."sessionId", v_accepted, v_max
      USING ERRCODE = 'exclusion_violation',
            CONSTRAINT = 'SessionParticipant_capacity';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "SessionParticipant_capacity_guard"
  BEFORE INSERT OR UPDATE OF "status", "sessionId"
  ON "SessionParticipant"
  FOR EACH ROW EXECUTE FUNCTION nexport_session_participant_capacity_guard();


-- 7. SESSION → EQUIPMENT BOOKING SYNC ----------------------------------------
-- Rescheduling a session shifts its equipment bookings by the same delta
-- (preserving any setup/teardown padding), which re-fires the capacity guard:
-- a reschedule into an equipment conflict fails as a whole.
-- Cancelling a session releases its equipment.
CREATE OR REPLACE FUNCTION nexport_session_equipment_sync()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."status" = 'CANCELLED' AND OLD."status" <> 'CANCELLED' THEN
    UPDATE "EquipmentBooking"
       SET "status" = 'CANCELLED', "updatedAt" = now()
     WHERE "sessionId" = NEW."id"
       AND "status" IN ('RESERVED', 'CHECKED_OUT');
    RETURN NEW;
  END IF;

  IF NEW."startsAt" IS DISTINCT FROM OLD."startsAt" OR NEW."endsAt" IS DISTINCT FROM OLD."endsAt" THEN
    UPDATE "EquipmentBooking"
       SET "startsAt"  = "startsAt" + (NEW."startsAt" - OLD."startsAt"),
           "endsAt"    = "endsAt"   + (NEW."endsAt"   - OLD."endsAt"),
           "updatedAt" = now()
     WHERE "sessionId" = NEW."id"
       AND "status" IN ('RESERVED', 'CHECKED_OUT');
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "PracticeSession_equipment_sync"
  AFTER UPDATE OF "startsAt", "endsAt", "status"
  ON "PracticeSession"
  FOR EACH ROW EXECUTE FUNCTION nexport_session_equipment_sync();
