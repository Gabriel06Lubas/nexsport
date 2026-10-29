CREATE TYPE "public"."AttendanceStatus" AS ENUM('PRESENT', 'LATE', 'ABSENT', 'EXCUSED');--> statement-breakpoint
CREATE TYPE "public"."ClubMemberStatus" AS ENUM('INVITED', 'ACTIVE', 'SUSPENDED', 'LEFT');--> statement-breakpoint
CREATE TYPE "public"."ClubPermission" AS ENUM('MANAGE_CLUB_SETTINGS', 'MANAGE_FACILITIES', 'MANAGE_EQUIPMENT', 'MANAGE_MEMBERS', 'MANAGE_SCHEDULE', 'MANAGE_BILLING', 'VIEW_ANALYTICS', 'MANAGE_SOCIAL');--> statement-breakpoint
CREATE TYPE "public"."ClubRole" AS ENUM('OWNER', 'STAFF', 'COACH', 'STUDENT');--> statement-breakpoint
CREATE TYPE "public"."ClubStatus" AS ENUM('PENDING_SETUP', 'ACTIVE', 'SUSPENDED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."ConversationType" AS ENUM('DIRECT', 'GROUP');--> statement-breakpoint
CREATE TYPE "public"."DisputeStatus" AS ENUM('NONE', 'WARNING_NEEDS_RESPONSE', 'WARNING_UNDER_REVIEW', 'WARNING_CLOSED', 'NEEDS_RESPONSE', 'UNDER_REVIEW', 'WON', 'LOST');--> statement-breakpoint
CREATE TYPE "public"."EquipmentBookingStatus" AS ENUM('RESERVED', 'CHECKED_OUT', 'RETURNED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."EquipmentCondition" AS ENUM('NEW', 'GOOD', 'FAIR', 'NEEDS_REPAIR', 'RETIRED');--> statement-breakpoint
CREATE TYPE "public"."FacilityType" AS ENUM('FOOTBALL_PITCH', 'FUTSAL_COURT', 'PADEL_COURT', 'TENNIS_COURT', 'BASKETBALL_COURT', 'GYM', 'STUDIO', 'POOL', 'TRACK', 'MULTIPURPOSE', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."FollowStatus" AS ENUM('PENDING', 'ACCEPTED');--> statement-breakpoint
CREATE TYPE "public"."MediaType" AS ENUM('IMAGE', 'VIDEO');--> statement-breakpoint
CREATE TYPE "public"."NotificationType" AS ENUM('SESSION_INVITE', 'SESSION_INVITE_ACCEPTED', 'SESSION_INVITE_DECLINED', 'SESSION_UPDATED', 'SESSION_CANCELLED', 'SESSION_REMINDER', 'ATTENDANCE_FEEDBACK', 'PAYMENT_SUCCEEDED', 'PAYMENT_FAILED', 'REFUND_ISSUED', 'CLUB_INVITE', 'NEW_FOLLOWER', 'FOLLOW_REQUEST', 'POST_LIKED', 'POST_COMMENTED', 'COMMENT_REPLIED', 'COMMENT_LIKED', 'NEW_MESSAGE', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."ParticipantStatus" AS ENUM('INVITED', 'ACCEPTED', 'DECLINED', 'WAITLISTED', 'CANCELLED', 'REMOVED');--> statement-breakpoint
CREATE TYPE "public"."PaymentStatus" AS ENUM('REQUIRES_PAYMENT_METHOD', 'REQUIRES_CONFIRMATION', 'REQUIRES_ACTION', 'PROCESSING', 'SUCCEEDED', 'CANCELED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."PostVisibility" AS ENUM('PUBLIC', 'FOLLOWERS', 'CLUB', 'PRIVATE');--> statement-breakpoint
CREATE TYPE "public"."RefundStatus" AS ENUM('NONE', 'PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."SessionStatus" AS ENUM('DRAFT', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."StripeAccountStatus" AS ENUM('ONBOARDING', 'PENDING_VERIFICATION', 'ACTIVE', 'RESTRICTED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."StripeAccountType" AS ENUM('EXPRESS', 'CUSTOM');--> statement-breakpoint
CREATE TYPE "public"."SubscriptionStatus" AS ENUM('INCOMPLETE', 'INCOMPLETE_EXPIRED', 'TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'UNPAID', 'PAUSED');--> statement-breakpoint
CREATE TYPE "public"."SubscriptionTier" AS ENUM('FREE', 'STARTER', 'PRO', 'ENTERPRISE');--> statement-breakpoint
CREATE TYPE "public"."SurfaceType" AS ENUM('NATURAL_GRASS', 'ARTIFICIAL_TURF', 'CLAY', 'HARD_COURT', 'SYNTHETIC', 'WOOD', 'RUBBER', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."TransferRecipientType" AS ENUM('CLUB', 'COACH');--> statement-breakpoint
CREATE TYPE "public"."TransferStatus" AS ENUM('PENDING', 'PAID', 'REVERSED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."UserRole" AS ENUM('SUPER_ADMIN', 'CLUB_OWNER', 'STAFF', 'COACH', 'STUDENT');--> statement-breakpoint
CREATE TABLE "Account" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"providerAccountId" text NOT NULL,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Follow" (
	"followerId" text NOT NULL,
	"followingId" text NOT NULL,
	"status" "FollowStatus" DEFAULT 'ACCEPTED' NOT NULL,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "Follow_pkey" PRIMARY KEY("followerId","followingId"),
	CONSTRAINT "Follow_no_self_follow" CHECK ("followerId" <> "followingId")
);
--> statement-breakpoint
CREATE TABLE "Profile" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"handle" text NOT NULL,
	"displayName" text NOT NULL,
	"bio" varchar(500),
	"avatarUrl" text,
	"coverUrl" text,
	"location" text,
	"websiteUrl" text,
	"dateOfBirth" date,
	"isPrivate" boolean DEFAULT false NOT NULL,
	"followerCount" integer DEFAULT 0 NOT NULL,
	"followingCount" integer DEFAULT 0 NOT NULL,
	"postCount" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "Profile_handle_format" CHECK ("handle" ~ '^[a-z0-9_.]{3,30}$'),
	CONSTRAINT "Profile_counters_non_negative" CHECK ("followerCount" >= 0 AND "followingCount" >= 0 AND "postCount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ProfileSport" (
	"profileId" text NOT NULL,
	"sportId" text NOT NULL,
	"level" text,
	CONSTRAINT "ProfileSport_pkey" PRIMARY KEY("profileId","sportId")
);
--> statement-breakpoint
CREATE TABLE "Session" (
	"id" text PRIMARY KEY NOT NULL,
	"tokenHash" text NOT NULL,
	"userId" text NOT NULL,
	"expires" timestamp (3) with time zone NOT NULL,
	"userAgent" varchar(512),
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"lastSeenAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "Session_tokenHash_sha256" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "User" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"emailVerified" timestamp (3) with time zone,
	"image" text,
	"role" "UserRole" DEFAULT 'STUDENT' NOT NULL,
	"onboardedAt" timestamp (3) with time zone,
	"activeClubId" text,
	"stripeCustomerId" text,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) with time zone NOT NULL,
	"deletedAt" timestamp (3) with time zone
);
--> statement-breakpoint
CREATE TABLE "AgeGroup" (
	"id" text PRIMARY KEY NOT NULL,
	"clubId" text NOT NULL,
	"sportId" text,
	"name" text NOT NULL,
	"minAge" integer,
	"maxAge" integer,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "AgeGroup_age_bounds" CHECK (("minAge" IS NULL OR "minAge" >= 0) AND ("maxAge" IS NULL OR "maxAge" >= 0) AND ("minAge" IS NULL OR "maxAge" IS NULL OR "minAge" <= "maxAge"))
);
--> statement-breakpoint
CREATE TABLE "Club" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"logoUrl" text,
	"coverUrl" text,
	"email" text,
	"phone" text,
	"websiteUrl" text,
	"addressLine1" text,
	"addressLine2" text,
	"city" text,
	"region" text,
	"postalCode" text,
	"country" char(2) NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"currency" char(3) DEFAULT 'eur' NOT NULL,
	"status" "ClubStatus" DEFAULT 'PENDING_SETUP' NOT NULL,
	"ownerId" text NOT NULL,
	"stripeCustomerId" text,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) with time zone NOT NULL,
	"deletedAt" timestamp (3) with time zone,
	CONSTRAINT "Club_slug_format" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "Club_currency_format" CHECK ("currency" ~ '^[a-z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "ClubMember" (
	"id" text PRIMARY KEY NOT NULL,
	"clubId" text NOT NULL,
	"userId" text NOT NULL,
	"role" "ClubRole" NOT NULL,
	"status" "ClubMemberStatus" DEFAULT 'INVITED' NOT NULL,
	"permissions" "ClubPermission"[] DEFAULT ARRAY[]::"ClubPermission"[] NOT NULL,
	"title" text,
	"ageGroupId" text,
	"invitedAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"joinedAt" timestamp (3) with time zone,
	"leftAt" timestamp (3) with time zone,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ClubSport" (
	"clubId" text NOT NULL,
	"sportId" text NOT NULL,
	CONSTRAINT "ClubSport_pkey" PRIMARY KEY("clubId","sportId")
);
--> statement-breakpoint
CREATE TABLE "CoachAssignment" (
	"id" text PRIMARY KEY NOT NULL,
	"clubId" text NOT NULL,
	"coachMemberId" text NOT NULL,
	"studentMemberId" text,
	"ageGroupId" text,
	"sportId" text,
	"startsOn" date DEFAULT now() NOT NULL,
	"endsOn" date,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "CoachAssignment_has_target" CHECK ("studentMemberId" IS NOT NULL OR "ageGroupId" IS NOT NULL),
	CONSTRAINT "CoachAssignment_date_order" CHECK ("endsOn" IS NULL OR "endsOn" >= "startsOn")
);
--> statement-breakpoint
CREATE TABLE "Equipment" (
	"id" text PRIMARY KEY NOT NULL,
	"clubId" text NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"sku" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"condition" "EquipmentCondition" DEFAULT 'GOOD' NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"notes" text,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "Equipment_id_clubId_key" UNIQUE("id","clubId"),
	CONSTRAINT "Equipment_quantity_non_negative" CHECK ("quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "Facility" (
	"id" text PRIMARY KEY NOT NULL,
	"clubId" text NOT NULL,
	"name" text NOT NULL,
	"type" "FacilityType" NOT NULL,
	"surface" "SurfaceType",
	"isIndoor" boolean DEFAULT false NOT NULL,
	"hasLighting" boolean DEFAULT false NOT NULL,
	"capacity" integer,
	"hourlyRateAmount" integer,
	"bufferMinutes" integer DEFAULT 0 NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "Facility_id_clubId_key" UNIQUE("id","clubId"),
	CONSTRAINT "Facility_capacity_positive" CHECK ("capacity" IS NULL OR "capacity" > 0),
	CONSTRAINT "Facility_buffer_non_negative" CHECK ("bufferMinutes" >= 0),
	CONSTRAINT "Facility_rate_non_negative" CHECK ("hourlyRateAmount" IS NULL OR "hourlyRateAmount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "FacilitySport" (
	"facilityId" text NOT NULL,
	"sportId" text NOT NULL,
	CONSTRAINT "FacilitySport_pkey" PRIMARY KEY("facilityId","sportId")
);
--> statement-breakpoint
CREATE TABLE "Sport" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"iconUrl" text,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Attendance" (
	"id" text PRIMARY KEY NOT NULL,
	"sessionId" text NOT NULL,
	"participantId" text NOT NULL,
	"userId" text NOT NULL,
	"status" "AttendanceStatus" NOT NULL,
	"checkedInAt" timestamp (3) with time zone,
	"markedById" text,
	"coachFeedback" text,
	"performanceRating" integer,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "Attendance_rating_range" CHECK ("performanceRating" IS NULL OR "performanceRating" BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE TABLE "EquipmentBooking" (
	"id" text PRIMARY KEY NOT NULL,
	"clubId" text NOT NULL,
	"equipmentId" text NOT NULL,
	"sessionId" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"startsAt" timestamp (3) with time zone NOT NULL,
	"endsAt" timestamp (3) with time zone NOT NULL,
	"status" "EquipmentBookingStatus" DEFAULT 'RESERVED' NOT NULL,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "EquipmentBooking_quantity_positive" CHECK ("quantity" > 0),
	CONSTRAINT "EquipmentBooking_time_order" CHECK ("endsAt" > "startsAt")
);
--> statement-breakpoint
CREATE TABLE "PracticeSession" (
	"id" text PRIMARY KEY NOT NULL,
	"clubId" text NOT NULL,
	"facilityId" text NOT NULL,
	"coachId" text NOT NULL,
	"sportId" text NOT NULL,
	"ageGroupId" text,
	"createdById" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"startsAt" timestamp (3) with time zone NOT NULL,
	"endsAt" timestamp (3) with time zone NOT NULL,
	"status" "SessionStatus" DEFAULT 'SCHEDULED' NOT NULL,
	"maxParticipants" integer,
	"priceAmount" integer DEFAULT 0 NOT NULL,
	"currency" char(3) DEFAULT 'eur' NOT NULL,
	"coachShareBps" integer DEFAULT 0 NOT NULL,
	"cancellationPolicyId" text,
	"seriesId" text,
	"cancelledAt" timestamp (3) with time zone,
	"cancelledById" text,
	"cancellationReason" text,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "PracticeSession_id_clubId_key" UNIQUE("id","clubId"),
	CONSTRAINT "PracticeSession_time_order" CHECK ("endsAt" > "startsAt"),
	CONSTRAINT "PracticeSession_price_non_negative" CHECK ("priceAmount" >= 0),
	CONSTRAINT "PracticeSession_currency_format" CHECK ("currency" ~ '^[a-z]{3}$'),
	CONSTRAINT "PracticeSession_coach_share_bps" CHECK ("coachShareBps" BETWEEN 0 AND 10000),
	CONSTRAINT "PracticeSession_max_participants_positive" CHECK ("maxParticipants" IS NULL OR "maxParticipants" > 0),
	CONSTRAINT "PracticeSession_cancellation_consistent" CHECK (("status" = 'CANCELLED') = ("cancelledAt" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "SessionParticipant" (
	"id" text PRIMARY KEY NOT NULL,
	"sessionId" text NOT NULL,
	"userId" text NOT NULL,
	"status" "ParticipantStatus" DEFAULT 'INVITED' NOT NULL,
	"invitedById" text,
	"invitedAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"respondedAt" timestamp (3) with time zone,
	"cancelledAt" timestamp (3) with time zone,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Comment" (
	"id" text PRIMARY KEY NOT NULL,
	"postId" text NOT NULL,
	"authorId" text NOT NULL,
	"parentId" text,
	"content" varchar(2000) NOT NULL,
	"likeCount" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) with time zone NOT NULL,
	"deletedAt" timestamp (3) with time zone,
	CONSTRAINT "Comment_likeCount_non_negative" CHECK ("likeCount" >= 0),
	CONSTRAINT "Comment_no_self_parent" CHECK ("parentId" IS NULL OR "parentId" <> "id")
);
--> statement-breakpoint
CREATE TABLE "Conversation" (
	"id" text PRIMARY KEY NOT NULL,
	"type" "ConversationType" NOT NULL,
	"clubId" text,
	"title" text,
	"directKey" text,
	"createdById" text NOT NULL,
	"lastMessageAt" timestamp (3) with time zone,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "Conversation_direct_has_key" CHECK ("type" <> 'DIRECT' OR "directKey" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "ConversationParticipant" (
	"conversationId" text NOT NULL,
	"userId" text NOT NULL,
	"isAdmin" boolean DEFAULT false NOT NULL,
	"joinedAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"lastReadAt" timestamp (3) with time zone,
	"mutedUntil" timestamp (3) with time zone,
	"leftAt" timestamp (3) with time zone,
	CONSTRAINT "ConversationParticipant_pkey" PRIMARY KEY("conversationId","userId")
);
--> statement-breakpoint
CREATE TABLE "Like" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"postId" text,
	"commentId" text,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "Like_exactly_one_target" CHECK (num_nonnulls("postId", "commentId") = 1)
);
--> statement-breakpoint
CREATE TABLE "Message" (
	"id" text PRIMARY KEY NOT NULL,
	"conversationId" text NOT NULL,
	"senderId" text NOT NULL,
	"content" varchar(4000) NOT NULL,
	"attachmentUrl" text,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"editedAt" timestamp (3) with time zone,
	"deletedAt" timestamp (3) with time zone
);
--> statement-breakpoint
CREATE TABLE "Post" (
	"id" text PRIMARY KEY NOT NULL,
	"authorId" text NOT NULL,
	"clubId" text,
	"content" varchar(5000),
	"visibility" "PostVisibility" DEFAULT 'PUBLIC' NOT NULL,
	"likeCount" integer DEFAULT 0 NOT NULL,
	"commentCount" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) with time zone NOT NULL,
	"deletedAt" timestamp (3) with time zone,
	CONSTRAINT "Post_counters_non_negative" CHECK ("likeCount" >= 0 AND "commentCount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "PostMedia" (
	"id" text PRIMARY KEY NOT NULL,
	"postId" text NOT NULL,
	"type" "MediaType" NOT NULL,
	"url" text NOT NULL,
	"storageKey" text,
	"width" integer,
	"height" integer,
	"durationS" integer,
	"position" integer DEFAULT 0 NOT NULL,
	"altText" text
);
--> statement-breakpoint
CREATE TABLE "CancellationPolicy" (
	"id" text PRIMARY KEY NOT NULL,
	"clubId" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"isDefault" boolean DEFAULT false NOT NULL,
	"organizerCancelRefundPercent" integer DEFAULT 100 NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "CancellationPolicy_organizer_refund_percent" CHECK ("organizerCancelRefundPercent" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE "CancellationPolicyRule" (
	"id" text PRIMARY KEY NOT NULL,
	"policyId" text NOT NULL,
	"minHoursBeforeStart" integer NOT NULL,
	"refundPercent" integer NOT NULL,
	CONSTRAINT "CancellationPolicyRule_hours_non_negative" CHECK ("minHoursBeforeStart" >= 0),
	CONSTRAINT "CancellationPolicyRule_percent_range" CHECK ("refundPercent" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE "PaymentTransaction" (
	"id" text PRIMARY KEY NOT NULL,
	"clubId" text NOT NULL,
	"sessionId" text NOT NULL,
	"participantId" text NOT NULL,
	"payerId" text NOT NULL,
	"coachId" text,
	"amount" integer NOT NULL,
	"currency" char(3) NOT NULL,
	"applicationFeeAmount" integer DEFAULT 0 NOT NULL,
	"stripeFeeAmount" integer,
	"status" "PaymentStatus" DEFAULT 'REQUIRES_PAYMENT_METHOD' NOT NULL,
	"stripePaymentIntentId" text NOT NULL,
	"stripeChargeId" text,
	"transferGroup" text NOT NULL,
	"idempotencyKey" text NOT NULL,
	"failureCode" text,
	"failureMessage" text,
	"refundStatus" "RefundStatus" DEFAULT 'NONE' NOT NULL,
	"refundedAmount" integer DEFAULT 0 NOT NULL,
	"refundReason" text,
	"appliedRefundPercent" integer,
	"cancellationPolicyId" text,
	"disputeStatus" "DisputeStatus" DEFAULT 'NONE' NOT NULL,
	"stripeDisputeId" text,
	"disputedAmount" integer,
	"disputeReason" text,
	"paidAt" timestamp (3) with time zone,
	"refundedAt" timestamp (3) with time zone,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "PaymentTransaction_amount_positive" CHECK ("amount" > 0),
	CONSTRAINT "PaymentTransaction_currency_format" CHECK ("currency" ~ '^[a-z]{3}$'),
	CONSTRAINT "PaymentTransaction_fee_bounds" CHECK ("applicationFeeAmount" >= 0 AND "applicationFeeAmount" <= "amount"),
	CONSTRAINT "PaymentTransaction_stripe_fee_non_negative" CHECK ("stripeFeeAmount" IS NULL OR "stripeFeeAmount" >= 0),
	CONSTRAINT "PaymentTransaction_refund_bounds" CHECK ("refundedAmount" >= 0 AND "refundedAmount" <= "amount"),
	CONSTRAINT "PaymentTransaction_refund_percent" CHECK ("appliedRefundPercent" IS NULL OR "appliedRefundPercent" BETWEEN 0 AND 100),
	CONSTRAINT "PaymentTransaction_dispute_amount" CHECK ("disputedAmount" IS NULL OR ("disputedAmount" > 0 AND "disputedAmount" <= "amount"))
);
--> statement-breakpoint
CREATE TABLE "PaymentTransfer" (
	"id" text PRIMARY KEY NOT NULL,
	"paymentId" text NOT NULL,
	"stripeAccountId" text NOT NULL,
	"recipientType" "TransferRecipientType" NOT NULL,
	"amount" integer NOT NULL,
	"currency" char(3) NOT NULL,
	"status" "TransferStatus" DEFAULT 'PENDING' NOT NULL,
	"stripeTransferId" text,
	"reversedAmount" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "PaymentTransfer_amount_positive" CHECK ("amount" > 0),
	CONSTRAINT "PaymentTransfer_reversal_bounds" CHECK ("reversedAmount" >= 0 AND "reversedAmount" <= "amount")
);
--> statement-breakpoint
CREATE TABLE "StripeAccount" (
	"id" text PRIMARY KEY NOT NULL,
	"clubId" text,
	"userId" text,
	"stripeAccountId" text NOT NULL,
	"type" "StripeAccountType" DEFAULT 'EXPRESS' NOT NULL,
	"status" "StripeAccountStatus" DEFAULT 'ONBOARDING' NOT NULL,
	"country" char(2) NOT NULL,
	"defaultCurrency" char(3) NOT NULL,
	"chargesEnabled" boolean DEFAULT false NOT NULL,
	"payoutsEnabled" boolean DEFAULT false NOT NULL,
	"detailsSubmitted" boolean DEFAULT false NOT NULL,
	"requirementsDue" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"disabledReason" text,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "StripeAccount_exactly_one_owner" CHECK (num_nonnulls("clubId", "userId") = 1)
);
--> statement-breakpoint
CREATE TABLE "StripeWebhookEvent" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"livemode" boolean NOT NULL,
	"processedAt" timestamp (3) with time zone,
	"error" text,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"clubId" text,
	"userId" text,
	"tier" "SubscriptionTier" NOT NULL,
	"status" "SubscriptionStatus" NOT NULL,
	"stripeCustomerId" text NOT NULL,
	"stripeSubscriptionId" text NOT NULL,
	"stripePriceId" text NOT NULL,
	"platformFeeBps" integer DEFAULT 1000 NOT NULL,
	"currentPeriodStart" timestamp (3) with time zone NOT NULL,
	"currentPeriodEnd" timestamp (3) with time zone NOT NULL,
	"cancelAtPeriodEnd" boolean DEFAULT false NOT NULL,
	"canceledAt" timestamp (3) with time zone,
	"trialEndsAt" timestamp (3) with time zone,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "Subscription_exactly_one_owner" CHECK (num_nonnulls("clubId", "userId") = 1),
	CONSTRAINT "Subscription_fee_bps" CHECK ("platformFeeBps" BETWEEN 0 AND 10000),
	CONSTRAINT "Subscription_period_order" CHECK ("currentPeriodEnd" >= "currentPeriodStart")
);
--> statement-breakpoint
CREATE TABLE "Notification" (
	"id" text PRIMARY KEY NOT NULL,
	"recipientId" text NOT NULL,
	"actorId" text,
	"type" "NotificationType" NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"href" text,
	"data" jsonb,
	"clubId" text,
	"sessionId" text,
	"postId" text,
	"commentId" text,
	"readAt" timestamp (3) with time zone,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_followerId_fkey" FOREIGN KEY ("followerId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_followingId_fkey" FOREIGN KEY ("followingId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ProfileSport" ADD CONSTRAINT "ProfileSport_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "public"."Profile"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ProfileSport" ADD CONSTRAINT "ProfileSport_sportId_fkey" FOREIGN KEY ("sportId") REFERENCES "public"."Sport"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "User" ADD CONSTRAINT "User_activeClubId_fkey" FOREIGN KEY ("activeClubId") REFERENCES "public"."Club"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "AgeGroup" ADD CONSTRAINT "AgeGroup_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "public"."Club"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "AgeGroup" ADD CONSTRAINT "AgeGroup_sportId_fkey" FOREIGN KEY ("sportId") REFERENCES "public"."Sport"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Club" ADD CONSTRAINT "Club_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."User"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ClubMember" ADD CONSTRAINT "ClubMember_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "public"."Club"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ClubMember" ADD CONSTRAINT "ClubMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ClubMember" ADD CONSTRAINT "ClubMember_ageGroupId_fkey" FOREIGN KEY ("ageGroupId") REFERENCES "public"."AgeGroup"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ClubSport" ADD CONSTRAINT "ClubSport_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "public"."Club"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ClubSport" ADD CONSTRAINT "ClubSport_sportId_fkey" FOREIGN KEY ("sportId") REFERENCES "public"."Sport"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "CoachAssignment" ADD CONSTRAINT "CoachAssignment_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "public"."Club"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "CoachAssignment" ADD CONSTRAINT "CoachAssignment_coachMemberId_fkey" FOREIGN KEY ("coachMemberId") REFERENCES "public"."ClubMember"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "CoachAssignment" ADD CONSTRAINT "CoachAssignment_studentMemberId_fkey" FOREIGN KEY ("studentMemberId") REFERENCES "public"."ClubMember"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "CoachAssignment" ADD CONSTRAINT "CoachAssignment_ageGroupId_fkey" FOREIGN KEY ("ageGroupId") REFERENCES "public"."AgeGroup"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "CoachAssignment" ADD CONSTRAINT "CoachAssignment_sportId_fkey" FOREIGN KEY ("sportId") REFERENCES "public"."Sport"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "public"."Club"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Facility" ADD CONSTRAINT "Facility_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "public"."Club"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "FacilitySport" ADD CONSTRAINT "FacilitySport_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "public"."Facility"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "FacilitySport" ADD CONSTRAINT "FacilitySport_sportId_fkey" FOREIGN KEY ("sportId") REFERENCES "public"."Sport"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "public"."PracticeSession"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "public"."SessionParticipant"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_markedById_fkey" FOREIGN KEY ("markedById") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "EquipmentBooking" ADD CONSTRAINT "EquipmentBooking_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "public"."Club"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "EquipmentBooking" ADD CONSTRAINT "EquipmentBooking_equipmentId_clubId_fkey" FOREIGN KEY ("equipmentId","clubId") REFERENCES "public"."Equipment"("id","clubId") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "EquipmentBooking" ADD CONSTRAINT "EquipmentBooking_sessionId_clubId_fkey" FOREIGN KEY ("sessionId","clubId") REFERENCES "public"."PracticeSession"("id","clubId") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "PracticeSession" ADD CONSTRAINT "PracticeSession_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "public"."Club"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "PracticeSession" ADD CONSTRAINT "PracticeSession_facilityId_clubId_fkey" FOREIGN KEY ("facilityId","clubId") REFERENCES "public"."Facility"("id","clubId") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "PracticeSession" ADD CONSTRAINT "PracticeSession_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "public"."User"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "PracticeSession" ADD CONSTRAINT "PracticeSession_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "PracticeSession" ADD CONSTRAINT "PracticeSession_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "PracticeSession" ADD CONSTRAINT "PracticeSession_sportId_fkey" FOREIGN KEY ("sportId") REFERENCES "public"."Sport"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "PracticeSession" ADD CONSTRAINT "PracticeSession_ageGroupId_fkey" FOREIGN KEY ("ageGroupId") REFERENCES "public"."AgeGroup"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "PracticeSession" ADD CONSTRAINT "PracticeSession_cancellationPolicyId_fkey" FOREIGN KEY ("cancellationPolicyId") REFERENCES "public"."CancellationPolicy"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "SessionParticipant" ADD CONSTRAINT "SessionParticipant_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "public"."PracticeSession"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "SessionParticipant" ADD CONSTRAINT "SessionParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "SessionParticipant" ADD CONSTRAINT "SessionParticipant_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "public"."Post"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "public"."Comment"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "public"."Club"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ConversationParticipant" ADD CONSTRAINT "ConversationParticipant_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "public"."Conversation"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ConversationParticipant" ADD CONSTRAINT "ConversationParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Like" ADD CONSTRAINT "Like_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Like" ADD CONSTRAINT "Like_postId_fkey" FOREIGN KEY ("postId") REFERENCES "public"."Post"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Like" ADD CONSTRAINT "Like_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "public"."Comment"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "public"."Conversation"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Post" ADD CONSTRAINT "Post_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Post" ADD CONSTRAINT "Post_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "public"."Club"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "PostMedia" ADD CONSTRAINT "PostMedia_postId_fkey" FOREIGN KEY ("postId") REFERENCES "public"."Post"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "CancellationPolicy" ADD CONSTRAINT "CancellationPolicy_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "public"."Club"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "CancellationPolicyRule" ADD CONSTRAINT "CancellationPolicyRule_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "public"."CancellationPolicy"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "public"."Club"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "public"."PracticeSession"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "public"."SessionParticipant"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "public"."User"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_cancellationPolicyId_fkey" FOREIGN KEY ("cancellationPolicyId") REFERENCES "public"."CancellationPolicy"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "PaymentTransfer" ADD CONSTRAINT "PaymentTransfer_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "public"."PaymentTransaction"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "PaymentTransfer" ADD CONSTRAINT "PaymentTransfer_stripeAccountId_fkey" FOREIGN KEY ("stripeAccountId") REFERENCES "public"."StripeAccount"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "StripeAccount" ADD CONSTRAINT "StripeAccount_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "public"."Club"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "StripeAccount" ADD CONSTRAINT "StripeAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "public"."Club"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "public"."Club"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "public"."PracticeSession"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_postId_fkey" FOREIGN KEY ("postId") REFERENCES "public"."Post"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "public"."Comment"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account" USING btree ("provider","providerAccountId");--> statement-breakpoint
CREATE INDEX "Account_userId_idx" ON "Account" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "Follow_followingId_status_idx" ON "Follow" USING btree ("followingId","status");--> statement-breakpoint
CREATE UNIQUE INDEX "Profile_userId_key" ON "Profile" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "Profile_handle_key" ON "Profile" USING btree ("handle");--> statement-breakpoint
CREATE INDEX "ProfileSport_sportId_idx" ON "ProfileSport" USING btree ("sportId");--> statement-breakpoint
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session" USING btree ("tokenHash");--> statement-breakpoint
CREATE INDEX "Session_userId_idx" ON "Session" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "Session_expires_idx" ON "Session" USING btree ("expires");--> statement-breakpoint
CREATE UNIQUE INDEX "User_email_key" ON "User" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "User_stripeCustomerId_key" ON "User" USING btree ("stripeCustomerId");--> statement-breakpoint
CREATE INDEX "User_role_idx" ON "User" USING btree ("role");--> statement-breakpoint
CREATE UNIQUE INDEX "AgeGroup_clubId_name_key" ON "AgeGroup" USING btree ("clubId","name");--> statement-breakpoint
CREATE UNIQUE INDEX "Club_slug_key" ON "Club" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "Club_stripeCustomerId_key" ON "Club" USING btree ("stripeCustomerId");--> statement-breakpoint
CREATE INDEX "Club_ownerId_idx" ON "Club" USING btree ("ownerId");--> statement-breakpoint
CREATE INDEX "Club_status_idx" ON "Club" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "ClubMember_clubId_userId_role_key" ON "ClubMember" USING btree ("clubId","userId","role");--> statement-breakpoint
CREATE INDEX "ClubMember_userId_status_idx" ON "ClubMember" USING btree ("userId","status");--> statement-breakpoint
CREATE INDEX "ClubMember_clubId_role_status_idx" ON "ClubMember" USING btree ("clubId","role","status");--> statement-breakpoint
CREATE INDEX "ClubSport_sportId_idx" ON "ClubSport" USING btree ("sportId");--> statement-breakpoint
CREATE INDEX "CoachAssignment_clubId_idx" ON "CoachAssignment" USING btree ("clubId");--> statement-breakpoint
CREATE INDEX "CoachAssignment_coachMemberId_idx" ON "CoachAssignment" USING btree ("coachMemberId");--> statement-breakpoint
CREATE INDEX "CoachAssignment_studentMemberId_idx" ON "CoachAssignment" USING btree ("studentMemberId");--> statement-breakpoint
CREATE UNIQUE INDEX "Equipment_clubId_sku_key" ON "Equipment" USING btree ("clubId","sku");--> statement-breakpoint
CREATE INDEX "Equipment_clubId_category_idx" ON "Equipment" USING btree ("clubId","category");--> statement-breakpoint
CREATE UNIQUE INDEX "Facility_clubId_name_key" ON "Facility" USING btree ("clubId","name");--> statement-breakpoint
CREATE INDEX "FacilitySport_sportId_idx" ON "FacilitySport" USING btree ("sportId");--> statement-breakpoint
CREATE UNIQUE INDEX "Sport_slug_key" ON "Sport" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "Attendance_participantId_key" ON "Attendance" USING btree ("participantId");--> statement-breakpoint
CREATE UNIQUE INDEX "Attendance_sessionId_userId_key" ON "Attendance" USING btree ("sessionId","userId");--> statement-breakpoint
CREATE INDEX "Attendance_userId_createdAt_idx" ON "Attendance" USING btree ("userId","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "EquipmentBooking_sessionId_equipmentId_key" ON "EquipmentBooking" USING btree ("sessionId","equipmentId");--> statement-breakpoint
CREATE INDEX "EquipmentBooking_equipmentId_startsAt_endsAt_idx" ON "EquipmentBooking" USING btree ("equipmentId","startsAt","endsAt");--> statement-breakpoint
CREATE INDEX "EquipmentBooking_clubId_idx" ON "EquipmentBooking" USING btree ("clubId");--> statement-breakpoint
CREATE INDEX "PracticeSession_clubId_startsAt_idx" ON "PracticeSession" USING btree ("clubId","startsAt");--> statement-breakpoint
CREATE INDEX "PracticeSession_coachId_startsAt_idx" ON "PracticeSession" USING btree ("coachId","startsAt");--> statement-breakpoint
CREATE INDEX "PracticeSession_facilityId_startsAt_idx" ON "PracticeSession" USING btree ("facilityId","startsAt");--> statement-breakpoint
CREATE INDEX "PracticeSession_seriesId_idx" ON "PracticeSession" USING btree ("seriesId");--> statement-breakpoint
CREATE UNIQUE INDEX "SessionParticipant_sessionId_userId_key" ON "SessionParticipant" USING btree ("sessionId","userId");--> statement-breakpoint
CREATE INDEX "SessionParticipant_userId_status_idx" ON "SessionParticipant" USING btree ("userId","status");--> statement-breakpoint
CREATE INDEX "SessionParticipant_sessionId_status_idx" ON "SessionParticipant" USING btree ("sessionId","status");--> statement-breakpoint
CREATE INDEX "Comment_postId_createdAt_idx" ON "Comment" USING btree ("postId","createdAt");--> statement-breakpoint
CREATE INDEX "Comment_parentId_idx" ON "Comment" USING btree ("parentId");--> statement-breakpoint
CREATE INDEX "Comment_authorId_idx" ON "Comment" USING btree ("authorId");--> statement-breakpoint
CREATE UNIQUE INDEX "Conversation_directKey_key" ON "Conversation" USING btree ("directKey");--> statement-breakpoint
CREATE INDEX "Conversation_clubId_idx" ON "Conversation" USING btree ("clubId");--> statement-breakpoint
CREATE INDEX "Conversation_lastMessageAt_idx" ON "Conversation" USING btree ("lastMessageAt" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "ConversationParticipant_userId_idx" ON "ConversationParticipant" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "Like_userId_postId_key" ON "Like" USING btree ("userId","postId");--> statement-breakpoint
CREATE UNIQUE INDEX "Like_userId_commentId_key" ON "Like" USING btree ("userId","commentId");--> statement-breakpoint
CREATE INDEX "Like_postId_idx" ON "Like" USING btree ("postId");--> statement-breakpoint
CREATE INDEX "Like_commentId_idx" ON "Like" USING btree ("commentId");--> statement-breakpoint
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message" USING btree ("conversationId","createdAt" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "Post_authorId_createdAt_idx" ON "Post" USING btree ("authorId","createdAt" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "Post_clubId_createdAt_idx" ON "Post" USING btree ("clubId","createdAt" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "Post_createdAt_idx" ON "Post" USING btree ("createdAt" DESC NULLS FIRST);--> statement-breakpoint
CREATE UNIQUE INDEX "PostMedia_postId_position_key" ON "PostMedia" USING btree ("postId","position");--> statement-breakpoint
CREATE UNIQUE INDEX "CancellationPolicy_clubId_name_key" ON "CancellationPolicy" USING btree ("clubId","name");--> statement-breakpoint
CREATE UNIQUE INDEX "CancellationPolicy_one_default_per_club" ON "CancellationPolicy" USING btree ("clubId") WHERE "isDefault";--> statement-breakpoint
CREATE UNIQUE INDEX "CancellationPolicyRule_policyId_minHoursBeforeStart_key" ON "CancellationPolicyRule" USING btree ("policyId","minHoursBeforeStart");--> statement-breakpoint
CREATE UNIQUE INDEX "PaymentTransaction_stripePaymentIntentId_key" ON "PaymentTransaction" USING btree ("stripePaymentIntentId");--> statement-breakpoint
CREATE UNIQUE INDEX "PaymentTransaction_stripeChargeId_key" ON "PaymentTransaction" USING btree ("stripeChargeId");--> statement-breakpoint
CREATE UNIQUE INDEX "PaymentTransaction_idempotencyKey_key" ON "PaymentTransaction" USING btree ("idempotencyKey");--> statement-breakpoint
CREATE UNIQUE INDEX "PaymentTransaction_stripeDisputeId_key" ON "PaymentTransaction" USING btree ("stripeDisputeId");--> statement-breakpoint
CREATE INDEX "PaymentTransaction_clubId_createdAt_idx" ON "PaymentTransaction" USING btree ("clubId","createdAt");--> statement-breakpoint
CREATE INDEX "PaymentTransaction_sessionId_idx" ON "PaymentTransaction" USING btree ("sessionId");--> statement-breakpoint
CREATE INDEX "PaymentTransaction_participantId_idx" ON "PaymentTransaction" USING btree ("participantId");--> statement-breakpoint
CREATE INDEX "PaymentTransaction_payerId_createdAt_idx" ON "PaymentTransaction" USING btree ("payerId","createdAt");--> statement-breakpoint
CREATE INDEX "PaymentTransaction_coachId_createdAt_idx" ON "PaymentTransaction" USING btree ("coachId","createdAt");--> statement-breakpoint
CREATE INDEX "PaymentTransaction_status_idx" ON "PaymentTransaction" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "PaymentTransaction_one_live_per_participant" ON "PaymentTransaction" USING btree ("participantId") WHERE "status" NOT IN ('CANCELED', 'FAILED');--> statement-breakpoint
CREATE UNIQUE INDEX "PaymentTransfer_stripeTransferId_key" ON "PaymentTransfer" USING btree ("stripeTransferId");--> statement-breakpoint
CREATE UNIQUE INDEX "PaymentTransfer_paymentId_recipientType_key" ON "PaymentTransfer" USING btree ("paymentId","recipientType");--> statement-breakpoint
CREATE INDEX "PaymentTransfer_stripeAccountId_createdAt_idx" ON "PaymentTransfer" USING btree ("stripeAccountId","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "StripeAccount_clubId_key" ON "StripeAccount" USING btree ("clubId");--> statement-breakpoint
CREATE UNIQUE INDEX "StripeAccount_userId_key" ON "StripeAccount" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "StripeAccount_stripeAccountId_key" ON "StripeAccount" USING btree ("stripeAccountId");--> statement-breakpoint
CREATE INDEX "StripeWebhookEvent_type_createdAt_idx" ON "StripeWebhookEvent" USING btree ("type","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "Subscription_stripeSubscriptionId_key" ON "Subscription" USING btree ("stripeSubscriptionId");--> statement-breakpoint
CREATE INDEX "Subscription_clubId_status_idx" ON "Subscription" USING btree ("clubId","status");--> statement-breakpoint
CREATE INDEX "Subscription_userId_status_idx" ON "Subscription" USING btree ("userId","status");--> statement-breakpoint
CREATE UNIQUE INDEX "Subscription_one_live_per_club" ON "Subscription" USING btree ("clubId") WHERE "clubId" IS NOT NULL AND "status" NOT IN ('CANCELED', 'INCOMPLETE_EXPIRED');--> statement-breakpoint
CREATE UNIQUE INDEX "Subscription_one_live_per_user" ON "Subscription" USING btree ("userId") WHERE "userId" IS NOT NULL AND "status" NOT IN ('CANCELED', 'INCOMPLETE_EXPIRED');--> statement-breakpoint
CREATE INDEX "Notification_recipientId_createdAt_idx" ON "Notification" USING btree ("recipientId","createdAt" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "Notification_unread_by_recipient" ON "Notification" USING btree ("recipientId","createdAt" DESC NULLS FIRST) WHERE "readAt" IS NULL;