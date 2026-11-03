CREATE TYPE "public"."PlanCheckoutKind" AS ENUM('CLUB_SIGNUP', 'CLUB_SUBSCRIPTION', 'COACH_PRO');--> statement-breakpoint
CREATE TYPE "public"."PlanCheckoutStatus" AS ENUM('OPEN', 'COMPLETED', 'EXPIRED', 'FAILED');--> statement-breakpoint
CREATE TABLE "PlanCheckout" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"kind" "PlanCheckoutKind" NOT NULL,
	"tier" "SubscriptionTier" NOT NULL,
	"status" "PlanCheckoutStatus" DEFAULT 'OPEN' NOT NULL,
	"clubId" text,
	"clubName" text,
	"clubSlug" text,
	"city" text,
	"country" char(2),
	"timezone" text,
	"currency" char(3),
	"stripeCheckoutSessionId" text,
	"stripeSubscriptionId" text,
	"error" text,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"completedAt" timestamp (3) with time zone,
	"updatedAt" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "PlanCheckout_kind_shape" CHECK (CASE "kind"
        WHEN 'CLUB_SIGNUP' THEN num_nonnulls("clubName", "clubSlug", "country", "timezone", "currency") = 5 AND "tier" IN ('CLUB_BASIC', 'CLUB_ENTERPRISE')
        WHEN 'CLUB_SUBSCRIPTION' THEN "clubId" IS NOT NULL AND "tier" IN ('CLUB_BASIC', 'CLUB_ENTERPRISE')
        WHEN 'COACH_PRO' THEN "tier" = 'PRO_COACH' AND "clubId" IS NULL
      END)
);
--> statement-breakpoint
ALTER TABLE "PlanCheckout" ADD CONSTRAINT "PlanCheckout_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "PlanCheckout" ADD CONSTRAINT "PlanCheckout_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "public"."Club"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "PlanCheckout_stripeCheckoutSessionId_key" ON "PlanCheckout" USING btree ("stripeCheckoutSessionId");--> statement-breakpoint
CREATE INDEX "PlanCheckout_userId_status_idx" ON "PlanCheckout" USING btree ("userId","status");--> statement-breakpoint
CREATE UNIQUE INDEX "PlanCheckout_open_slug_key" ON "PlanCheckout" USING btree ("clubSlug") WHERE "status" = 'OPEN' AND "clubSlug" IS NOT NULL;