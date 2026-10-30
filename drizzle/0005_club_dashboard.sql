CREATE TYPE "public"."EmploymentType" AS ENUM('EMPLOYEE', 'FREELANCE');--> statement-breakpoint
CREATE TYPE "public"."FacilityBookingStatus" AS ENUM('CONFIRMED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."MembershipPlanKind" AS ENUM('UNLIMITED', 'CREDITS');--> statement-breakpoint
CREATE TYPE "public"."PaymentKind" AS ENUM('SESSION', 'COURT_RENTAL', 'MEMBERSHIP');--> statement-breakpoint
CREATE TYPE "public"."PaymentMethod" AS ENUM('ONLINE', 'ON_SITE', 'COMPLIMENTARY');--> statement-breakpoint
CREATE TYPE "public"."PriceTier" AS ENUM('PEAK', 'OFF_PEAK');--> statement-breakpoint
CREATE TABLE "EquipmentMaintenance" (
	"id" text PRIMARY KEY NOT NULL,
	"clubId" text NOT NULL,
	"equipmentId" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"reason" text NOT NULL,
	"reportedById" text,
	"startedAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"resolvedAt" timestamp (3) with time zone,
	"resolvedById" text,
	"resolutionNotes" text,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "EquipmentMaintenance_quantity_positive" CHECK ("quantity" > 0),
	CONSTRAINT "EquipmentMaintenance_resolution_order" CHECK ("resolvedAt" IS NULL OR "resolvedAt" >= "startedAt")
);
--> statement-breakpoint
CREATE TABLE "FacilityBooking" (
	"id" text PRIMARY KEY NOT NULL,
	"clubId" text NOT NULL,
	"facilityId" text NOT NULL,
	"customerId" text,
	"customerName" text,
	"bookedById" text,
	"startsAt" timestamp (3) with time zone NOT NULL,
	"endsAt" timestamp (3) with time zone NOT NULL,
	"status" "FacilityBookingStatus" DEFAULT 'CONFIRMED' NOT NULL,
	"priceAmount" integer NOT NULL,
	"currency" char(3) DEFAULT 'eur' NOT NULL,
	"paymentMethod" "PaymentMethod" NOT NULL,
	"paidAt" timestamp (3) with time zone,
	"notes" text,
	"cancelledAt" timestamp (3) with time zone,
	"cancelledById" text,
	"cancellationReason" text,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "FacilityBooking_id_clubId_key" UNIQUE("id","clubId"),
	CONSTRAINT "FacilityBooking_time_order" CHECK ("endsAt" > "startsAt"),
	CONSTRAINT "FacilityBooking_price_non_negative" CHECK ("priceAmount" >= 0),
	CONSTRAINT "FacilityBooking_currency_format" CHECK ("currency" ~ '^[a-z]{3}$'),
	CONSTRAINT "FacilityBooking_cancellation_consistent" CHECK (("status" = 'CANCELLED') = ("cancelledAt" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "FacilityPriceRule" (
	"id" text PRIMARY KEY NOT NULL,
	"clubId" text NOT NULL,
	"facilityId" text NOT NULL,
	"dayOfWeek" smallint NOT NULL,
	"startMinute" integer NOT NULL,
	"endMinute" integer NOT NULL,
	"tier" "PriceTier" NOT NULL,
	"hourlyRateAmount" integer NOT NULL,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "FacilityPriceRule_day_of_week" CHECK ("dayOfWeek" BETWEEN 1 AND 7),
	CONSTRAINT "FacilityPriceRule_window" CHECK ("startMinute" >= 0 AND "startMinute" < "endMinute" AND "endMinute" <= 1440 AND "startMinute" % 15 = 0 AND "endMinute" % 15 = 0),
	CONSTRAINT "FacilityPriceRule_rate_non_negative" CHECK ("hourlyRateAmount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "MemberPass" (
	"id" text PRIMARY KEY NOT NULL,
	"clubId" text NOT NULL,
	"planId" text NOT NULL,
	"userId" text NOT NULL,
	"creditsTotal" integer,
	"creditsUsed" integer DEFAULT 0 NOT NULL,
	"startsAt" timestamp (3) with time zone NOT NULL,
	"expiresAt" timestamp (3) with time zone NOT NULL,
	"priceAmount" integer NOT NULL,
	"currency" char(3) NOT NULL,
	"paymentMethod" "PaymentMethod" NOT NULL,
	"paidAt" timestamp (3) with time zone,
	"soldById" text,
	"cancelledAt" timestamp (3) with time zone,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "MemberPass_id_clubId_key" UNIQUE("id","clubId"),
	CONSTRAINT "MemberPass_credits" CHECK ("creditsUsed" >= 0 AND ("creditsTotal" IS NULL OR ("creditsTotal" > 0 AND "creditsUsed" <= "creditsTotal"))),
	CONSTRAINT "MemberPass_period_order" CHECK ("expiresAt" > "startsAt"),
	CONSTRAINT "MemberPass_price_non_negative" CHECK ("priceAmount" >= 0),
	CONSTRAINT "MemberPass_currency_format" CHECK ("currency" ~ '^[a-z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "MembershipPlan" (
	"id" text PRIMARY KEY NOT NULL,
	"clubId" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"kind" "MembershipPlanKind" NOT NULL,
	"priceAmount" integer NOT NULL,
	"currency" char(3) DEFAULT 'eur' NOT NULL,
	"durationDays" integer NOT NULL,
	"creditCount" integer,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "MembershipPlan_id_clubId_key" UNIQUE("id","clubId"),
	CONSTRAINT "MembershipPlan_price_non_negative" CHECK ("priceAmount" >= 0),
	CONSTRAINT "MembershipPlan_currency_format" CHECK ("currency" ~ '^[a-z]{3}$'),
	CONSTRAINT "MembershipPlan_duration" CHECK ("durationDays" BETWEEN 1 AND 3660),
	CONSTRAINT "MembershipPlan_credits_match_kind" CHECK (("kind" = 'CREDITS' AND "creditCount" IS NOT NULL AND "creditCount" BETWEEN 1 AND 1000) OR ("kind" = 'UNLIMITED' AND "creditCount" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "PaymentTransaction" ALTER COLUMN "sessionId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "PaymentTransaction" ALTER COLUMN "participantId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ClubMember" ADD COLUMN "employmentType" "EmploymentType";--> statement-breakpoint
ALTER TABLE "ClubMember" ADD COLUMN "hourlyWageAmount" integer;--> statement-breakpoint
ALTER TABLE "ClubMember" ADD COLUMN "commissionBps" integer;--> statement-breakpoint
ALTER TABLE "Facility" ADD COLUMN "openMinute" integer DEFAULT 420 NOT NULL;--> statement-breakpoint
ALTER TABLE "Facility" ADD COLUMN "closeMinute" integer DEFAULT 1380 NOT NULL;--> statement-breakpoint
ALTER TABLE "PaymentTransaction" ADD COLUMN "kind" "PaymentKind" DEFAULT 'SESSION' NOT NULL;--> statement-breakpoint
ALTER TABLE "PaymentTransaction" ADD COLUMN "facilityBookingId" text;--> statement-breakpoint
ALTER TABLE "PaymentTransaction" ADD COLUMN "memberPassId" text;--> statement-breakpoint
ALTER TABLE "EquipmentMaintenance" ADD CONSTRAINT "EquipmentMaintenance_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "public"."Club"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "EquipmentMaintenance" ADD CONSTRAINT "EquipmentMaintenance_equipmentId_clubId_fkey" FOREIGN KEY ("equipmentId","clubId") REFERENCES "public"."Equipment"("id","clubId") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "EquipmentMaintenance" ADD CONSTRAINT "EquipmentMaintenance_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "EquipmentMaintenance" ADD CONSTRAINT "EquipmentMaintenance_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "FacilityBooking" ADD CONSTRAINT "FacilityBooking_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "public"."Club"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "FacilityBooking" ADD CONSTRAINT "FacilityBooking_facilityId_clubId_fkey" FOREIGN KEY ("facilityId","clubId") REFERENCES "public"."Facility"("id","clubId") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "FacilityBooking" ADD CONSTRAINT "FacilityBooking_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "FacilityBooking" ADD CONSTRAINT "FacilityBooking_bookedById_fkey" FOREIGN KEY ("bookedById") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "FacilityBooking" ADD CONSTRAINT "FacilityBooking_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "FacilityPriceRule" ADD CONSTRAINT "FacilityPriceRule_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "public"."Club"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "FacilityPriceRule" ADD CONSTRAINT "FacilityPriceRule_facilityId_clubId_fkey" FOREIGN KEY ("facilityId","clubId") REFERENCES "public"."Facility"("id","clubId") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "MemberPass" ADD CONSTRAINT "MemberPass_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "public"."Club"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "MemberPass" ADD CONSTRAINT "MemberPass_planId_clubId_fkey" FOREIGN KEY ("planId","clubId") REFERENCES "public"."MembershipPlan"("id","clubId") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "MemberPass" ADD CONSTRAINT "MemberPass_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "MemberPass" ADD CONSTRAINT "MemberPass_soldById_fkey" FOREIGN KEY ("soldById") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "MembershipPlan" ADD CONSTRAINT "MembershipPlan_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "public"."Club"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "EquipmentMaintenance_clubId_startedAt_idx" ON "EquipmentMaintenance" USING btree ("clubId","startedAt");--> statement-breakpoint
CREATE INDEX "EquipmentMaintenance_equipmentId_resolvedAt_idx" ON "EquipmentMaintenance" USING btree ("equipmentId","resolvedAt");--> statement-breakpoint
CREATE INDEX "FacilityBooking_clubId_startsAt_idx" ON "FacilityBooking" USING btree ("clubId","startsAt");--> statement-breakpoint
CREATE INDEX "FacilityBooking_facilityId_startsAt_idx" ON "FacilityBooking" USING btree ("facilityId","startsAt");--> statement-breakpoint
CREATE INDEX "FacilityBooking_customerId_idx" ON "FacilityBooking" USING btree ("customerId");--> statement-breakpoint
CREATE INDEX "FacilityPriceRule_facilityId_dayOfWeek_idx" ON "FacilityPriceRule" USING btree ("facilityId","dayOfWeek");--> statement-breakpoint
CREATE INDEX "FacilityPriceRule_clubId_idx" ON "FacilityPriceRule" USING btree ("clubId");--> statement-breakpoint
CREATE INDEX "MemberPass_clubId_expiresAt_idx" ON "MemberPass" USING btree ("clubId","expiresAt");--> statement-breakpoint
CREATE INDEX "MemberPass_userId_idx" ON "MemberPass" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "MembershipPlan_clubId_name_key" ON "MembershipPlan" USING btree ("clubId","name");--> statement-breakpoint
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_facilityBookingId_clubId_fkey" FOREIGN KEY ("facilityBookingId","clubId") REFERENCES "public"."FacilityBooking"("id","clubId") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_memberPassId_clubId_fkey" FOREIGN KEY ("memberPassId","clubId") REFERENCES "public"."MemberPass"("id","clubId") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "PaymentTransaction_one_live_per_facility_booking" ON "PaymentTransaction" USING btree ("facilityBookingId") WHERE "status" NOT IN ('CANCELED', 'FAILED');--> statement-breakpoint
CREATE UNIQUE INDEX "PaymentTransaction_one_live_per_member_pass" ON "PaymentTransaction" USING btree ("memberPassId") WHERE "status" NOT IN ('CANCELED', 'FAILED');--> statement-breakpoint
CREATE INDEX "PaymentTransaction_clubId_kind_paidAt_idx" ON "PaymentTransaction" USING btree ("clubId","kind","paidAt");--> statement-breakpoint
ALTER TABLE "ClubMember" ADD CONSTRAINT "ClubMember_wage_non_negative" CHECK ("hourlyWageAmount" IS NULL OR "hourlyWageAmount" >= 0);--> statement-breakpoint
ALTER TABLE "ClubMember" ADD CONSTRAINT "ClubMember_commission_bps" CHECK ("commissionBps" IS NULL OR "commissionBps" BETWEEN 0 AND 10000);--> statement-breakpoint
ALTER TABLE "Facility" ADD CONSTRAINT "Facility_opening_hours" CHECK ("openMinute" >= 0 AND "openMinute" < "closeMinute" AND "closeMinute" <= 1440);--> statement-breakpoint
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_kind_target" CHECK (CASE "kind"
        WHEN 'SESSION' THEN num_nonnulls("sessionId", "participantId") = 2 AND num_nonnulls("facilityBookingId", "memberPassId") = 0
        WHEN 'COURT_RENTAL' THEN "facilityBookingId" IS NOT NULL AND num_nonnulls("sessionId", "participantId", "memberPassId") = 0
        WHEN 'MEMBERSHIP' THEN "memberPassId" IS NOT NULL AND num_nonnulls("sessionId", "participantId", "facilityBookingId") = 0
      END);