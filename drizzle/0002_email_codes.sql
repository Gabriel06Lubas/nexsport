CREATE TYPE "public"."EmailCodePurpose" AS ENUM('SIGN_IN', 'VERIFY_EMAIL');--> statement-breakpoint
CREATE TABLE "EmailCode" (
	"id" text PRIMARY KEY NOT NULL,
	"purpose" "EmailCodePurpose" NOT NULL,
	"email" text NOT NULL,
	"userId" text,
	"codeHash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expiresAt" timestamp (3) with time zone NOT NULL,
	"consumedAt" timestamp (3) with time zone,
	"ipHash" text,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "EmailCode_codeHash_hex" CHECK ("codeHash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "EmailCode_attempts_range" CHECK ("attempts" BETWEEN 0 AND 5),
	CONSTRAINT "EmailCode_email_length" CHECK (char_length("email") BETWEEN 3 AND 254),
	CONSTRAINT "EmailCode_verify_has_user" CHECK ("purpose" <> 'VERIFY_EMAIL' OR "userId" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "EmailCode" ADD CONSTRAINT "EmailCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "EmailCode_email_createdAt_idx" ON "EmailCode" USING btree ("email","createdAt");--> statement-breakpoint
CREATE INDEX "EmailCode_ipHash_createdAt_idx" ON "EmailCode" USING btree ("ipHash","createdAt");--> statement-breakpoint
CREATE INDEX "EmailCode_userId_idx" ON "EmailCode" USING btree ("userId");