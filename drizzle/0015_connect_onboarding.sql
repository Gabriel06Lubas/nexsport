ALTER TABLE "PaymentTransfer" ADD COLUMN "failureMessage" text;--> statement-breakpoint
ALTER TABLE "StripeAccount" ADD COLUMN "transfersEnabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Accounts already able to take charges were onboarded with the transfers capability too.
UPDATE "StripeAccount" SET "transfersEnabled" = true WHERE "chargesEnabled";
