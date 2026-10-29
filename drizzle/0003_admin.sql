-- Admin dashboard: ADMIN role, SubscriptionPlan catalogue, audit log,
-- suspension and impersonation support.
--
-- Enum values are renamed in place (drizzle-kit's generated version dropped
-- and recreated both types through a text cast, which fails on existing
-- rows). The resulting types are identical, so the snapshot still matches.
ALTER TYPE "public"."UserRole" RENAME VALUE 'SUPER_ADMIN' TO 'ADMIN';--> statement-breakpoint
ALTER TYPE "public"."SubscriptionTier" RENAME VALUE 'FREE' TO 'FREE_COACH';--> statement-breakpoint
ALTER TYPE "public"."SubscriptionTier" RENAME VALUE 'PRO' TO 'PRO_COACH';--> statement-breakpoint
ALTER TYPE "public"."SubscriptionTier" RENAME VALUE 'STARTER' TO 'CLUB_BASIC';--> statement-breakpoint
ALTER TYPE "public"."SubscriptionTier" RENAME VALUE 'ENTERPRISE' TO 'CLUB_ENTERPRISE';--> statement-breakpoint
CREATE TYPE "public"."AdminAction" AS ENUM('PLAN_UPDATED', 'TENANT_SUSPENDED', 'TENANT_REACTIVATED', 'IMPERSONATION_STARTED', 'IMPERSONATION_ENDED');--> statement-breakpoint
CREATE TYPE "public"."PlanAudience" AS ENUM('COACH', 'CLUB');--> statement-breakpoint
CREATE TABLE "SubscriptionPlan" (
	"tier" "SubscriptionTier" PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"audience" "PlanAudience" NOT NULL,
	"monthlyPriceAmount" integer NOT NULL,
	"currency" char(3) DEFAULT 'eur' NOT NULL,
	"platformFeeBps" integer NOT NULL,
	"stripePriceId" text,
	"maxFacilities" integer,
	"maxStaff" integer,
	"maxAthletes" integer,
	"isActive" boolean DEFAULT true NOT NULL,
	"updatedAt" timestamp (3) with time zone NOT NULL,
	"updatedById" text,
	CONSTRAINT "SubscriptionPlan_price_non_negative" CHECK ("monthlyPriceAmount" >= 0),
	CONSTRAINT "SubscriptionPlan_fee_bps" CHECK ("platformFeeBps" BETWEEN 0 AND 10000),
	CONSTRAINT "SubscriptionPlan_currency_format" CHECK ("currency" ~ '^[a-z]{3}$'),
	CONSTRAINT "SubscriptionPlan_stripe_price_format" CHECK ("stripePriceId" IS NULL OR "stripePriceId" ~ '^price_[A-Za-z0-9]{8,64}$'),
	CONSTRAINT "SubscriptionPlan_limits_positive" CHECK (("maxFacilities" IS NULL OR "maxFacilities" >= 0) AND ("maxStaff" IS NULL OR "maxStaff" >= 0) AND ("maxAthletes" IS NULL OR "maxAthletes" >= 0)),
	CONSTRAINT "SubscriptionPlan_paid_has_price" CHECK ("monthlyPriceAmount" = 0 OR "stripePriceId" IS NOT NULL OR NOT "isActive")
);
--> statement-breakpoint
CREATE TABLE "AdminAuditLog" (
	"id" text PRIMARY KEY NOT NULL,
	"actorId" text,
	"actorEmail" text NOT NULL,
	"action" "AdminAction" NOT NULL,
	"targetType" text NOT NULL,
	"targetId" text NOT NULL,
	"targetLabel" text,
	"reason" varchar(500),
	"details" jsonb,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "AdminAuditLog_target_type" CHECK ("targetType" IN ('club', 'coach', 'plan'))
);
--> statement-breakpoint
ALTER TABLE "Session" ADD COLUMN "impersonatorId" text;--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN "suspendedAt" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN "suspensionReason" varchar(500);--> statement-breakpoint
ALTER TABLE "Subscription" ADD COLUMN "monthlyAmount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "Subscription" ADD COLUMN "currency" char(3) DEFAULT 'eur' NOT NULL;--> statement-breakpoint
ALTER TABLE "SubscriptionPlan" ADD CONSTRAINT "SubscriptionPlan_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "SubscriptionPlan_stripePriceId_key" ON "SubscriptionPlan" USING btree ("stripePriceId");--> statement-breakpoint
CREATE INDEX "AdminAuditLog_createdAt_idx" ON "AdminAuditLog" USING btree ("createdAt" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "AdminAuditLog_target_idx" ON "AdminAuditLog" USING btree ("targetType","targetId");--> statement-breakpoint
ALTER TABLE "Session" ADD CONSTRAINT "Session_impersonatorId_fkey" FOREIGN KEY ("impersonatorId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_monthly_amount_non_negative" CHECK ("monthlyAmount" >= 0);--> statement-breakpoint
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_currency_format" CHECK ("currency" ~ '^[a-z]{3}$');