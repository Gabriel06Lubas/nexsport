CREATE TYPE "public"."SessionKind" AS ENUM('PRIVATE', 'GROUP', 'OPEN_MATCH');--> statement-breakpoint
CREATE TABLE "CoachAvailability" (
	"id" text PRIMARY KEY NOT NULL,
	"coachId" text NOT NULL,
	"clubId" text NOT NULL,
	"facilityId" text,
	"dayOfWeek" smallint NOT NULL,
	"startMinute" integer NOT NULL,
	"endMinute" integer NOT NULL,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "CoachAvailability_day_of_week" CHECK ("dayOfWeek" BETWEEN 1 AND 7),
	CONSTRAINT "CoachAvailability_window" CHECK ("startMinute" >= 0 AND "startMinute" < "endMinute" AND "endMinute" <= 1440 AND "startMinute" % 15 = 0 AND "endMinute" % 15 = 0)
);
--> statement-breakpoint
CREATE TABLE "CoachProfile" (
	"userId" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"headline" text,
	"bio" text,
	"bookingEnabled" boolean DEFAULT false NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"sportId" text,
	"privateRateAmount" integer,
	"groupRateAmount" integer,
	"currency" char(3) DEFAULT 'eur' NOT NULL,
	"sessionMinutes" integer DEFAULT 60 NOT NULL,
	"minNoticeHours" integer DEFAULT 12 NOT NULL,
	"maxAdvanceDays" integer DEFAULT 21 NOT NULL,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "CoachProfile_slug_format" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length("slug") BETWEEN 3 AND 48),
	CONSTRAINT "CoachProfile_rates_non_negative" CHECK (("privateRateAmount" IS NULL OR "privateRateAmount" >= 0) AND ("groupRateAmount" IS NULL OR "groupRateAmount" >= 0)),
	CONSTRAINT "CoachProfile_currency_format" CHECK ("currency" ~ '^[a-z]{3}$'),
	CONSTRAINT "CoachProfile_session_minutes" CHECK ("sessionMinutes" BETWEEN 30 AND 180 AND "sessionMinutes" % 15 = 0),
	CONSTRAINT "CoachProfile_notice" CHECK ("minNoticeHours" BETWEEN 0 AND 168 AND "maxAdvanceDays" BETWEEN 1 AND 90),
	CONSTRAINT "CoachProfile_bookable" CHECK (NOT "bookingEnabled" OR ("privateRateAmount" IS NOT NULL AND "sportId" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "PassCreditAdjustment" (
	"id" text PRIMARY KEY NOT NULL,
	"clubId" text NOT NULL,
	"passId" text NOT NULL,
	"delta" smallint NOT NULL,
	"reason" text NOT NULL,
	"actorId" text,
	"sessionId" text,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "PassCreditAdjustment_delta" CHECK ("delta" IN (-1, 1))
);
--> statement-breakpoint
ALTER TABLE "PracticeSession" ADD COLUMN "kind" "SessionKind" DEFAULT 'GROUP' NOT NULL;--> statement-breakpoint
ALTER TABLE "CoachAvailability" ADD CONSTRAINT "CoachAvailability_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "CoachAvailability" ADD CONSTRAINT "CoachAvailability_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "public"."Club"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "CoachAvailability" ADD CONSTRAINT "CoachAvailability_facilityId_clubId_fkey" FOREIGN KEY ("facilityId","clubId") REFERENCES "public"."Facility"("id","clubId") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "CoachProfile" ADD CONSTRAINT "CoachProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "CoachProfile" ADD CONSTRAINT "CoachProfile_sportId_fkey" FOREIGN KEY ("sportId") REFERENCES "public"."Sport"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "PassCreditAdjustment" ADD CONSTRAINT "PassCreditAdjustment_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "public"."Club"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "PassCreditAdjustment" ADD CONSTRAINT "PassCreditAdjustment_passId_clubId_fkey" FOREIGN KEY ("passId","clubId") REFERENCES "public"."MemberPass"("id","clubId") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "PassCreditAdjustment" ADD CONSTRAINT "PassCreditAdjustment_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "PassCreditAdjustment" ADD CONSTRAINT "PassCreditAdjustment_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "public"."PracticeSession"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "CoachAvailability_coachId_dayOfWeek_idx" ON "CoachAvailability" USING btree ("coachId","dayOfWeek");--> statement-breakpoint
CREATE INDEX "CoachAvailability_clubId_idx" ON "CoachAvailability" USING btree ("clubId");--> statement-breakpoint
CREATE UNIQUE INDEX "CoachProfile_slug_key" ON "CoachProfile" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "PassCreditAdjustment_passId_createdAt_idx" ON "PassCreditAdjustment" USING btree ("passId","createdAt");--> statement-breakpoint
CREATE INDEX "PassCreditAdjustment_actorId_createdAt_idx" ON "PassCreditAdjustment" USING btree ("actorId","createdAt");