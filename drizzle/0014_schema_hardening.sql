ALTER TABLE "Account" ALTER COLUMN "updatedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "Profile" ALTER COLUMN "updatedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "User" ALTER COLUMN "updatedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "AgeGroup" ALTER COLUMN "updatedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "Club" ALTER COLUMN "updatedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "ClubMember" ALTER COLUMN "updatedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "Equipment" ALTER COLUMN "updatedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "EquipmentMaintenance" ALTER COLUMN "updatedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "Facility" ALTER COLUMN "updatedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "Attendance" ALTER COLUMN "updatedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "EquipmentBooking" ALTER COLUMN "updatedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "FacilityBooking" ALTER COLUMN "updatedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "FacilityPriceRule" ALTER COLUMN "updatedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "PracticeSession" ALTER COLUMN "updatedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "SessionParticipant" ALTER COLUMN "updatedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "MemberPass" ALTER COLUMN "updatedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "MembershipPlan" ALTER COLUMN "updatedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "CoachAvailability" ALTER COLUMN "updatedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "CoachProfile" ALTER COLUMN "updatedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "AthleteSettings" ALTER COLUMN "updatedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "Comment" ALTER COLUMN "updatedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "Conversation" ALTER COLUMN "updatedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "Post" ALTER COLUMN "updatedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "CancellationPolicy" ALTER COLUMN "updatedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "PaymentTransaction" ALTER COLUMN "updatedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "PaymentTransfer" ALTER COLUMN "updatedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "PlanCheckout" ALTER COLUMN "updatedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "StripeAccount" ALTER COLUMN "updatedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "Subscription" ALTER COLUMN "updatedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "SubscriptionPlan" ALTER COLUMN "updatedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "FacilityBooking" ADD COLUMN "holdExpiresAt" timestamp (3) with time zone;--> statement-breakpoint
CREATE INDEX "Session_impersonatorId_fk_idx" ON "Session" USING btree ("impersonatorId") WHERE "impersonatorId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "User_activeClubId_fk_idx" ON "User" USING btree ("activeClubId") WHERE "activeClubId" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "AgeGroup_id_clubId_key" ON "AgeGroup" USING btree ("id","clubId");--> statement-breakpoint
CREATE INDEX "AgeGroup_sportId_fk_idx" ON "AgeGroup" USING btree ("sportId") WHERE "sportId" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ClubMember_id_clubId_key" ON "ClubMember" USING btree ("id","clubId");--> statement-breakpoint
CREATE INDEX "ClubMember_ageGroupId_fk_idx" ON "ClubMember" USING btree ("ageGroupId") WHERE "ageGroupId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "CoachAssignment_ageGroupId_fk_idx" ON "CoachAssignment" USING btree ("ageGroupId") WHERE "ageGroupId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "CoachAssignment_sportId_fk_idx" ON "CoachAssignment" USING btree ("sportId") WHERE "sportId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "EquipmentMaintenance_reportedById_fk_idx" ON "EquipmentMaintenance" USING btree ("reportedById") WHERE "reportedById" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "EquipmentMaintenance_resolvedById_fk_idx" ON "EquipmentMaintenance" USING btree ("resolvedById") WHERE "resolvedById" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "Attendance_markedById_fk_idx" ON "Attendance" USING btree ("markedById") WHERE "markedById" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "FacilityBooking_open_holds_idx" ON "FacilityBooking" USING btree ("holdExpiresAt") WHERE "status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "FacilityBooking_bookedById_fk_idx" ON "FacilityBooking" USING btree ("bookedById") WHERE "bookedById" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "FacilityBooking_cancelledById_fk_idx" ON "FacilityBooking" USING btree ("cancelledById") WHERE "cancelledById" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "PracticeSession_createdById_fk_idx" ON "PracticeSession" USING btree ("createdById");--> statement-breakpoint
CREATE INDEX "PracticeSession_cancelledById_fk_idx" ON "PracticeSession" USING btree ("cancelledById") WHERE "cancelledById" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "PracticeSession_sportId_fk_idx" ON "PracticeSession" USING btree ("sportId");--> statement-breakpoint
CREATE INDEX "PracticeSession_ageGroupId_fk_idx" ON "PracticeSession" USING btree ("ageGroupId") WHERE "ageGroupId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "PracticeSession_cancellationPolicyId_fk_idx" ON "PracticeSession" USING btree ("cancellationPolicyId") WHERE "cancellationPolicyId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "SessionParticipant_invitedById_fk_idx" ON "SessionParticipant" USING btree ("invitedById") WHERE "invitedById" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "MemberPass_planId_fk_idx" ON "MemberPass" USING btree ("planId");--> statement-breakpoint
CREATE INDEX "MemberPass_soldById_fk_idx" ON "MemberPass" USING btree ("soldById") WHERE "soldById" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "CoachAvailability_facilityId_fk_idx" ON "CoachAvailability" USING btree ("facilityId") WHERE "facilityId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "CoachProfile_sportId_fk_idx" ON "CoachProfile" USING btree ("sportId") WHERE "sportId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "PassCreditAdjustment_clubId_fk_idx" ON "PassCreditAdjustment" USING btree ("clubId");--> statement-breakpoint
CREATE INDEX "PassCreditAdjustment_sessionId_fk_idx" ON "PassCreditAdjustment" USING btree ("sessionId") WHERE "sessionId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "Conversation_createdById_fk_idx" ON "Conversation" USING btree ("createdById");--> statement-breakpoint
CREATE INDEX "Message_senderId_fk_idx" ON "Message" USING btree ("senderId");--> statement-breakpoint
CREATE UNIQUE INDEX "CancellationPolicy_id_clubId_key" ON "CancellationPolicy" USING btree ("id","clubId");--> statement-breakpoint
CREATE INDEX "PaymentTransaction_cancellationPolicyId_fk_idx" ON "PaymentTransaction" USING btree ("cancellationPolicyId") WHERE "cancellationPolicyId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "PlanCheckout_clubId_fk_idx" ON "PlanCheckout" USING btree ("clubId") WHERE "clubId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "SubscriptionPlan_updatedById_fk_idx" ON "SubscriptionPlan" USING btree ("updatedById") WHERE "updatedById" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "Notification_actorId_fk_idx" ON "Notification" USING btree ("actorId") WHERE "actorId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "Notification_clubId_fk_idx" ON "Notification" USING btree ("clubId") WHERE "clubId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "Notification_sessionId_fk_idx" ON "Notification" USING btree ("sessionId") WHERE "sessionId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "Notification_postId_fk_idx" ON "Notification" USING btree ("postId") WHERE "postId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "Notification_commentId_fk_idx" ON "Notification" USING btree ("commentId") WHERE "commentId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "AdminAuditLog_actorId_fk_idx" ON "AdminAuditLog" USING btree ("actorId") WHERE "actorId" IS NOT NULL;--> statement-breakpoint
-- Holds already open get their payment's expiry (or lapse now) before the check applies.
UPDATE "FacilityBooking" b SET "holdExpiresAt" = COALESCE(
  (SELECT max(pt."checkoutExpiresAt") FROM "PaymentTransaction" pt WHERE pt."facilityBookingId" = b.id AND pt.status NOT IN ('CANCELED', 'FAILED')),
  now())
 WHERE b.status = 'PENDING';--> statement-breakpoint
ALTER TABLE "FacilityBooking" ADD CONSTRAINT "FacilityBooking_hold_consistent" CHECK ("status" <> 'PENDING' OR "holdExpiresAt" IS NOT NULL);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- updatedAt maintained by the database
-- ---------------------------------------------------------------------------
-- Until now only Drizzle set it, so updates from raw SQL, the guard triggers
-- (equipment sync, capacity) and scripts left it stale. One BEFORE UPDATE
-- trigger per table; a no-op UPDATE (nothing changed) keeps the old value.
CREATE OR REPLACE FUNCTION nexport_touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW IS DISTINCT FROM OLD THEN
    NEW."updatedAt" := now();
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND a.attname = 'updatedAt' AND NOT a.attisdropped
  LOOP
    EXECUTE format('CREATE OR REPLACE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION nexport_touch_updated_at()', t || '_touch_updated_at', t);
  END LOOP;
END $$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Same-club foreign keys
-- ---------------------------------------------------------------------------
-- These references were single-column, so the database accepted a row of
-- one club pointing at another club's row (a payment for club A on club B's
-- session, a coach assignment pairing members of two clubs). Each gets a
-- composite FK on (key, clubId) next to the existing one, with the same
-- delete behaviour; SET NULL only clears the key column (PostgreSQL 15+),
-- never clubId. Drizzle can't express the column list, so they live here;
-- tests/db/schema_contract.test.sql checks they exist.
ALTER TABLE "CoachAssignment" ADD CONSTRAINT "CoachAssignment_coachMemberId_same_club_fkey"
  FOREIGN KEY ("coachMemberId", "clubId") REFERENCES "ClubMember"("id", "clubId") ON UPDATE CASCADE ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "CoachAssignment" ADD CONSTRAINT "CoachAssignment_studentMemberId_same_club_fkey"
  FOREIGN KEY ("studentMemberId", "clubId") REFERENCES "ClubMember"("id", "clubId") ON UPDATE CASCADE ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "CoachAssignment" ADD CONSTRAINT "CoachAssignment_ageGroupId_same_club_fkey"
  FOREIGN KEY ("ageGroupId", "clubId") REFERENCES "AgeGroup"("id", "clubId") ON UPDATE CASCADE ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ClubMember" ADD CONSTRAINT "ClubMember_ageGroupId_same_club_fkey"
  FOREIGN KEY ("ageGroupId", "clubId") REFERENCES "AgeGroup"("id", "clubId") ON UPDATE CASCADE ON DELETE SET NULL ("ageGroupId");--> statement-breakpoint
ALTER TABLE "PracticeSession" ADD CONSTRAINT "PracticeSession_ageGroupId_same_club_fkey"
  FOREIGN KEY ("ageGroupId", "clubId") REFERENCES "AgeGroup"("id", "clubId") ON UPDATE CASCADE ON DELETE SET NULL ("ageGroupId");--> statement-breakpoint
ALTER TABLE "PracticeSession" ADD CONSTRAINT "PracticeSession_cancellationPolicyId_same_club_fkey"
  FOREIGN KEY ("cancellationPolicyId", "clubId") REFERENCES "CancellationPolicy"("id", "clubId") ON UPDATE CASCADE ON DELETE SET NULL ("cancellationPolicyId");--> statement-breakpoint
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_cancellationPolicyId_same_club_fkey"
  FOREIGN KEY ("cancellationPolicyId", "clubId") REFERENCES "CancellationPolicy"("id", "clubId") ON UPDATE CASCADE ON DELETE SET NULL ("cancellationPolicyId");--> statement-breakpoint
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_sessionId_same_club_fkey"
  FOREIGN KEY ("sessionId", "clubId") REFERENCES "PracticeSession"("id", "clubId") ON UPDATE CASCADE ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "PassCreditAdjustment" ADD CONSTRAINT "PassCreditAdjustment_sessionId_same_club_fkey"
  FOREIGN KEY ("sessionId", "clubId") REFERENCES "PracticeSession"("id", "clubId") ON UPDATE CASCADE ON DELETE SET NULL ("sessionId");--> statement-breakpoint

-- Analytics: revenue by paidAt; bookings capped at 24 hours so time windows can bound "startsAt".
CREATE INDEX "FacilityBooking_clubId_paidAt_idx" ON "FacilityBooking" USING btree ("clubId","paidAt");--> statement-breakpoint
CREATE INDEX "MemberPass_clubId_paidAt_idx" ON "MemberPass" USING btree ("clubId","paidAt");--> statement-breakpoint
ALTER TABLE "FacilityBooking" ADD CONSTRAINT "FacilityBooking_max_duration" CHECK ("endsAt" - "startsAt" <= interval '24 hours');--> statement-breakpoint
ALTER TABLE "PracticeSession" ADD CONSTRAINT "PracticeSession_max_duration" CHECK ("endsAt" - "startsAt" <= interval '24 hours');
