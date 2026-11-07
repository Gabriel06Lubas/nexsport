ALTER TABLE "Profile" ADD COLUMN "firstName" text;--> statement-breakpoint
ALTER TABLE "Profile" ADD COLUMN "lastName" text;--> statement-breakpoint
ALTER TABLE "Profile" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_phone_e164" CHECK ("phone" IS NULL OR "phone" ~ '^[+][1-9][0-9]{6,14}$');--> statement-breakpoint
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_name_length" CHECK ((char_length("firstName") BETWEEN 1 AND 50) AND (char_length("lastName") BETWEEN 1 AND 50));