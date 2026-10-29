-- Custom SQL migration (drizzle-kit generate --custom --name=booking_guards).
--
-- Database guards that Drizzle Kit can't express in the schema. CHECK
-- constraints and partial unique indexes live in src/db/schema/*.ts; this
-- file holds only:
--   1. the btree_gist extension
--   4. Facility double-booking guard   (GiST exclusion constraint)
--   5. Equipment over-allocation guard (row-locking trigger)
--   6. Session seat-capacity guard     (row-locking trigger)
--   7. Session -> equipment booking sync (reschedule / cancel cascade)
-- (Section numbers match docs/step-1-database.md.)
--
-- Every guard raises SQLSTATE 23P01 (exclusion_violation) with a stable
-- constraint name so the app maps them to one domain error:
--   "PracticeSession_facility_no_overlap"
--   "EquipmentBooking_capacity"
--   "SessionParticipant_capacity"
--
-- Drizzle Kit only diffs the schema against its own snapshots, so it never
-- sees (or drops) these objects. Don't use `drizzle-kit push` on a database
-- that relies on them; use `generate` + `migrate`.

-- 1. EXTENSIONS ---------------------------------------------------------------
-- btree_gist lets a GiST index combine scalar equality (facilityId =) with
-- range overlap (tstzrange &&) inside a single exclusion constraint.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint

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
--> statement-breakpoint


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
--> statement-breakpoint

CREATE TRIGGER "EquipmentBooking_capacity_guard"
  BEFORE INSERT OR UPDATE OF "equipmentId", "quantity", "startsAt", "endsAt", "status"
  ON "EquipmentBooking"
  FOR EACH ROW EXECUTE FUNCTION nexport_equipment_booking_capacity_guard();
--> statement-breakpoint

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
--> statement-breakpoint

CREATE TRIGGER "Equipment_stock_guard"
  BEFORE UPDATE OF "quantity" ON "Equipment"
  FOR EACH ROW EXECUTE FUNCTION nexport_equipment_stock_guard();
--> statement-breakpoint


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
--> statement-breakpoint

CREATE TRIGGER "SessionParticipant_capacity_guard"
  BEFORE INSERT OR UPDATE OF "status", "sessionId"
  ON "SessionParticipant"
  FOR EACH ROW EXECUTE FUNCTION nexport_session_participant_capacity_guard();
--> statement-breakpoint


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
--> statement-breakpoint

CREATE TRIGGER "PracticeSession_equipment_sync"
  AFTER UPDATE OF "startsAt", "endsAt", "status"
  ON "PracticeSession"
  FOR EACH ROW EXECUTE FUNCTION nexport_session_equipment_sync();
