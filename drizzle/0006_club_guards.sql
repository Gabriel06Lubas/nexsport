-- Custom SQL migration (drizzle-kit generate --custom --name=club_guards).
--
-- Database guards for the club dashboard that Drizzle Kit can't express,
-- in the style of 0001_booking_guards.sql. All of them raise SQLSTATE 23P01
-- (exclusion_violation) with a stable constraint name:
--   "FacilityBooking_no_overlap"     two court rentals overlap
--   "FacilityPriceRule_no_overlap"   two price windows overlap (same day)
--   "Facility_booking_overlap"       a rental and a coached session overlap
--   "EquipmentMaintenance_capacity"  more units in repair than exist
--   "EquipmentBooking_capacity"      (existing) now also counts units in repair

-- 1. COURT RENTAL DOUBLE-BOOKING ---------------------------------------------
ALTER TABLE "FacilityBooking"
  ADD CONSTRAINT "FacilityBooking_no_overlap"
  EXCLUDE USING gist (
    "facilityId" WITH =,
    tstzrange("startsAt", "endsAt", '[)') WITH &&
  ) WHERE ("status" <> 'CANCELLED');
--> statement-breakpoint

-- 2. PRICE WINDOWS ------------------------------------------------------------
-- One rate per minute of the week: windows of the same facility and weekday
-- may touch (08:00-10:00, 10:00-12:00) but not overlap.
ALTER TABLE "FacilityPriceRule"
  ADD CONSTRAINT "FacilityPriceRule_no_overlap"
  EXCLUDE USING gist (
    "facilityId" WITH =,
    "dayOfWeek" WITH =,
    int4range("startMinute", "endMinute", '[)') WITH &&
  );
--> statement-breakpoint

-- 3. RENTALS vs COACHED SESSIONS ---------------------------------------------
-- An exclusion constraint can't span two tables, so a trigger on each side
-- checks the other. Both lock the Facility row first (a no-op UPDATE, as in
-- 0001): a rental and a session racing for the same slot are serialised, so
-- the second one always sees the first. Under REPEATABLE READ the loser gets
-- a serialization failure (40001) instead of a stale snapshot.
CREATE OR REPLACE FUNCTION nexport_facility_cross_overlap_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_conflict boolean;
BEGIN
  -- Cancelled rows hold no time; a reversed range is left for the
  -- *_time_order CHECK to report (tstzrange would raise its own error).
  IF NEW."status" = 'CANCELLED' OR NEW."endsAt" <= NEW."startsAt" THEN
    RETURN NEW;
  END IF;

  UPDATE "Facility" SET "updatedAt" = "updatedAt" WHERE "id" = NEW."facilityId";

  IF TG_TABLE_NAME = 'FacilityBooking' THEN
    SELECT EXISTS (
      SELECT 1 FROM "PracticeSession" s
       WHERE s."facilityId" = NEW."facilityId"
         AND s."status" <> 'CANCELLED'
         AND tstzrange(s."startsAt", s."endsAt", '[)') && tstzrange(NEW."startsAt", NEW."endsAt", '[)')
    ) INTO v_conflict;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM "FacilityBooking" b
       WHERE b."facilityId" = NEW."facilityId"
         AND b."status" <> 'CANCELLED'
         AND tstzrange(b."startsAt", b."endsAt", '[)') && tstzrange(NEW."startsAt", NEW."endsAt", '[)')
    ) INTO v_conflict;
  END IF;

  IF v_conflict THEN
    RAISE EXCEPTION 'Facility % is already booked between % and %', NEW."facilityId", NEW."startsAt", NEW."endsAt"
      USING ERRCODE = 'exclusion_violation',
            CONSTRAINT = 'Facility_booking_overlap';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER "FacilityBooking_session_overlap_guard"
  BEFORE INSERT OR UPDATE OF "facilityId", "startsAt", "endsAt", "status"
  ON "FacilityBooking"
  FOR EACH ROW EXECUTE FUNCTION nexport_facility_cross_overlap_guard();
--> statement-breakpoint

CREATE TRIGGER "PracticeSession_rental_overlap_guard"
  BEFORE INSERT OR UPDATE OF "facilityId", "startsAt", "endsAt", "status"
  ON "PracticeSession"
  FOR EACH ROW EXECUTE FUNCTION nexport_facility_cross_overlap_guard();
--> statement-breakpoint

-- 4. EQUIPMENT IN MAINTENANCE -------------------------------------------------
-- Units under repair (EquipmentMaintenance with resolvedAt IS NULL) are out
-- of the bookable stock.
CREATE OR REPLACE FUNCTION nexport_equipment_units_in_repair(p_equipment_id text)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM("quantity"), 0)::integer
    FROM "EquipmentMaintenance"
   WHERE "equipmentId" = p_equipment_id AND "resolvedAt" IS NULL;
$$;
--> statement-breakpoint

-- 4a. Booking guard (replaces the 0001 version): stock = quantity - in repair.
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
  IF NEW."status" NOT IN ('RESERVED', 'CHECKED_OUT') THEN
    RETURN NEW;
  END IF;

  -- No-op UPDATE as the row lock; see 0001_booking_guards.sql.
  UPDATE "Equipment" SET "updatedAt" = "updatedAt"
   WHERE "id" = NEW."equipmentId"
  RETURNING "quantity", "isActive", "condition"
       INTO v_stock, v_active, v_condition;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF NOT v_active OR v_condition IN ('RETIRED', 'NEEDS_REPAIR') THEN
    RAISE EXCEPTION 'Equipment % is not available for booking', NEW."equipmentId"
      USING ERRCODE = 'exclusion_violation',
            CONSTRAINT = 'EquipmentBooking_capacity';
  END IF;

  v_stock := v_stock - nexport_equipment_units_in_repair(NEW."equipmentId");

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

-- 4b. Stock guard (replaces the 0001 version): a stock reduction must leave
-- room for the units in repair as well as the peak reservation.
CREATE OR REPLACE FUNCTION nexport_equipment_stock_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_peak   integer;
  v_repair integer;
BEGIN
  IF NEW."quantity" >= OLD."quantity" THEN
    RETURN NEW;
  END IF;

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

  v_repair := nexport_equipment_units_in_repair(NEW."id");

  IF v_peak + v_repair > NEW."quantity" THEN
    RAISE EXCEPTION 'Cannot reduce equipment % stock to %: % units reserved at peak and % in repair',
      NEW."id", NEW."quantity", v_peak, v_repair
      USING ERRCODE = 'exclusion_violation',
            CONSTRAINT = 'EquipmentBooking_capacity';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- 4c. Maintenance guard: never more units in repair than the line holds.
-- Units already reserved for future sessions are deliberately not checked:
-- a broken racket is broken, and staff see the shortfall on the inventory
-- page rather than being prevented from logging it.
CREATE OR REPLACE FUNCTION nexport_equipment_maintenance_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_stock  integer;
  v_repair integer;
BEGIN
  IF NEW."resolvedAt" IS NOT NULL THEN
    RETURN NEW;
  END IF;

  UPDATE "Equipment" SET "updatedAt" = "updatedAt"
   WHERE "id" = NEW."equipmentId"
  RETURNING "quantity" INTO v_stock;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM("quantity"), 0) INTO v_repair
    FROM "EquipmentMaintenance"
   WHERE "equipmentId" = NEW."equipmentId" AND "resolvedAt" IS NULL AND "id" <> NEW."id";

  IF v_repair + NEW."quantity" > v_stock THEN
    RAISE EXCEPTION 'Equipment % has % units, % already in repair', NEW."equipmentId", v_stock, v_repair
      USING ERRCODE = 'exclusion_violation',
            CONSTRAINT = 'EquipmentMaintenance_capacity';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER "EquipmentMaintenance_capacity_guard"
  BEFORE INSERT OR UPDATE OF "equipmentId", "quantity", "resolvedAt"
  ON "EquipmentMaintenance"
  FOR EACH ROW EXECUTE FUNCTION nexport_equipment_maintenance_guard();
