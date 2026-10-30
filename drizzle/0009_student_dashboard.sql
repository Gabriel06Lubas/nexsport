CREATE TABLE "AthletePreferredClub" (
	"userId" text NOT NULL,
	"clubId" text NOT NULL,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "AthletePreferredClub_pkey" PRIMARY KEY("userId","clubId")
);
--> statement-breakpoint
CREATE TABLE "AthleteSettings" (
	"userId" text PRIMARY KEY NOT NULL,
	"matchAlerts" boolean DEFAULT true NOT NULL,
	"bookingUpdates" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "PaymentTransaction" ALTER COLUMN "stripePaymentIntentId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ProfileSport" ADD COLUMN "levelRating" numeric(3, 1);--> statement-breakpoint
ALTER TABLE "PracticeSession" ADD COLUMN "minLevel" numeric(3, 1);--> statement-breakpoint
ALTER TABLE "PracticeSession" ADD COLUMN "maxLevel" numeric(3, 1);--> statement-breakpoint
ALTER TABLE "PaymentTransaction" ADD COLUMN "stripeCheckoutSessionId" text;--> statement-breakpoint
ALTER TABLE "PaymentTransaction" ADD COLUMN "checkoutUrl" text;--> statement-breakpoint
ALTER TABLE "PaymentTransaction" ADD COLUMN "checkoutExpiresAt" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "AthletePreferredClub" ADD CONSTRAINT "AthletePreferredClub_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "AthletePreferredClub" ADD CONSTRAINT "AthletePreferredClub_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "public"."Club"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "AthleteSettings" ADD CONSTRAINT "AthleteSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "AthletePreferredClub_clubId_idx" ON "AthletePreferredClub" USING btree ("clubId");--> statement-breakpoint
CREATE UNIQUE INDEX "PaymentTransaction_stripeCheckoutSessionId_key" ON "PaymentTransaction" USING btree ("stripeCheckoutSessionId");--> statement-breakpoint
ALTER TABLE "ProfileSport" ADD CONSTRAINT "ProfileSport_level_rating" CHECK ("levelRating" IS NULL OR "levelRating" BETWEEN 0 AND 10);--> statement-breakpoint
ALTER TABLE "PracticeSession" ADD CONSTRAINT "PracticeSession_level_range" CHECK (("minLevel" IS NULL OR "minLevel" BETWEEN 0 AND 10) AND ("maxLevel" IS NULL OR "maxLevel" BETWEEN 0 AND 10) AND ("minLevel" IS NULL OR "maxLevel" IS NULL OR "minLevel" <= "maxLevel"));