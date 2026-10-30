-- Custom SQL migration (drizzle-kit generate --custom --name=coach_guards).
--
-- Coach dashboard guards, in the style of 0001/0006 (SQLSTATE 23P01, stable
-- constraint names; see tests/db/coach_guards.test.sql):
--   "PracticeSession_coach_no_overlap"  a coach in two sessions at once
--   "CoachAvailability_no_overlap"      two availability windows overlap

-- A coach can't run two non-cancelled sessions that overlap, at any club.
-- Two students self-booking the same slot at the same moment: one wins.
ALTER TABLE "PracticeSession"
  ADD CONSTRAINT "PracticeSession_coach_no_overlap"
  EXCLUDE USING gist (
    "coachId" WITH =,
    tstzrange("startsAt", "endsAt", '[)') WITH &&
  ) WHERE ("status" <> 'CANCELLED');
--> statement-breakpoint

-- Weekly windows of one coach on one weekday may touch but not overlap.
ALTER TABLE "CoachAvailability"
  ADD CONSTRAINT "CoachAvailability_no_overlap"
  EXCLUDE USING gist (
    "coachId" WITH =,
    "dayOfWeek" WITH =,
    int4range("startMinute", "endMinute", '[)') WITH &&
  );
