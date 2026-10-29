import { pgEnum } from "drizzle-orm/pg-core";

// ---- Identity & clubs -------------------------------------------------------

/** Platform-wide role, exposed on the session for coarse RBAC.
 *  Fine-grained, per-club authority lives in `ClubMember.role`. */
export const userRole = pgEnum("UserRole", ["SUPER_ADMIN", "CLUB_OWNER", "STAFF", "COACH", "STUDENT"]);

/** Why a one-time email code was sent. */
export const emailCodePurpose = pgEnum("EmailCodePurpose", [
  "SIGN_IN", // "Continue with email": proves the address and signs the user in
  "VERIFY_EMAIL", // confirms the email of a signed-in user (e.g. after Google/Apple sign-up)
]);

/** The role a user holds *inside a specific club*. */
export const clubRole = pgEnum("ClubRole", ["OWNER", "STAFF", "COACH", "STUDENT"]);

export const clubMemberStatus = pgEnum("ClubMemberStatus", ["INVITED", "ACTIVE", "SUSPENDED", "LEFT"]);

/** Granular permissions granted to STAFF members (owners implicitly have all). */
export const clubPermission = pgEnum("ClubPermission", [
  "MANAGE_CLUB_SETTINGS",
  "MANAGE_FACILITIES",
  "MANAGE_EQUIPMENT",
  "MANAGE_MEMBERS",
  "MANAGE_SCHEDULE",
  "MANAGE_BILLING",
  "VIEW_ANALYTICS",
  "MANAGE_SOCIAL",
]);

export const clubStatus = pgEnum("ClubStatus", ["PENDING_SETUP", "ACTIVE", "SUSPENDED", "ARCHIVED"]);

export const facilityType = pgEnum("FacilityType", [
  "FOOTBALL_PITCH",
  "FUTSAL_COURT",
  "PADEL_COURT",
  "TENNIS_COURT",
  "BASKETBALL_COURT",
  "GYM",
  "STUDIO",
  "POOL",
  "TRACK",
  "MULTIPURPOSE",
  "OTHER",
]);

export const surfaceType = pgEnum("SurfaceType", [
  "NATURAL_GRASS",
  "ARTIFICIAL_TURF",
  "CLAY",
  "HARD_COURT",
  "SYNTHETIC",
  "WOOD",
  "RUBBER",
  "OTHER",
]);

export const equipmentCondition = pgEnum("EquipmentCondition", ["NEW", "GOOD", "FAIR", "NEEDS_REPAIR", "RETIRED"]);

export const equipmentBookingStatus = pgEnum("EquipmentBookingStatus", ["RESERVED", "CHECKED_OUT", "RETURNED", "CANCELLED"]);

// ---- Scheduling -------------------------------------------------------------

export const sessionStatus = pgEnum("SessionStatus", ["DRAFT", "SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]);

export const participantStatus = pgEnum("ParticipantStatus", [
  "INVITED",
  "ACCEPTED",
  "DECLINED",
  "WAITLISTED",
  "CANCELLED", // participant cancelled after accepting (refund policy applies)
  "REMOVED", // removed by coach/staff
]);

export const attendanceStatus = pgEnum("AttendanceStatus", ["PRESENT", "LATE", "ABSENT", "EXCUSED"]);

// ---- Social & messaging -----------------------------------------------------

export const followStatus = pgEnum("FollowStatus", [
  "PENDING", // target profile is private and has not approved yet
  "ACCEPTED",
]);

export const postVisibility = pgEnum("PostVisibility", [
  "PUBLIC",
  "FOLLOWERS",
  "CLUB", // visible to members of `Post.clubId`
  "PRIVATE",
]);

export const mediaType = pgEnum("MediaType", ["IMAGE", "VIDEO"]);

export const conversationType = pgEnum("ConversationType", ["DIRECT", "GROUP"]);

// ---- Billing ----------------------------------------------------------------

export const subscriptionTier = pgEnum("SubscriptionTier", ["FREE", "STARTER", "PRO", "ENTERPRISE"]);

/** Mirrors Stripe's `subscription.status`. */
export const subscriptionStatus = pgEnum("SubscriptionStatus", [
  "INCOMPLETE",
  "INCOMPLETE_EXPIRED",
  "TRIALING",
  "ACTIVE",
  "PAST_DUE",
  "CANCELED",
  "UNPAID",
  "PAUSED",
]);

export const stripeAccountType = pgEnum("StripeAccountType", ["EXPRESS", "CUSTOM"]);

export const stripeAccountStatus = pgEnum("StripeAccountStatus", [
  "ONBOARDING", // created, KYC not yet submitted
  "PENDING_VERIFICATION", // submitted, Stripe reviewing
  "ACTIVE", // charges_enabled && payouts_enabled
  "RESTRICTED", // requirements past due
  "REJECTED",
]);

/** Mirrors the Stripe PaymentIntent lifecycle. */
export const paymentStatus = pgEnum("PaymentStatus", [
  "REQUIRES_PAYMENT_METHOD",
  "REQUIRES_CONFIRMATION",
  "REQUIRES_ACTION",
  "PROCESSING",
  "SUCCEEDED",
  "CANCELED",
  "FAILED",
]);

export const refundStatus = pgEnum("RefundStatus", ["NONE", "PENDING", "PARTIALLY_REFUNDED", "REFUNDED", "FAILED"]);

/** Mirrors Stripe's `dispute.status` (chargebacks). */
export const disputeStatus = pgEnum("DisputeStatus", [
  "NONE",
  "WARNING_NEEDS_RESPONSE",
  "WARNING_UNDER_REVIEW",
  "WARNING_CLOSED",
  "NEEDS_RESPONSE",
  "UNDER_REVIEW",
  "WON",
  "LOST",
]);

export const transferRecipientType = pgEnum("TransferRecipientType", ["CLUB", "COACH"]);

export const transferStatus = pgEnum("TransferStatus", ["PENDING", "PAID", "REVERSED", "FAILED"]);

// ---- Notifications ----------------------------------------------------------

export const notificationType = pgEnum("NotificationType", [
  "SESSION_INVITE",
  "SESSION_INVITE_ACCEPTED",
  "SESSION_INVITE_DECLINED",
  "SESSION_UPDATED",
  "SESSION_CANCELLED",
  "SESSION_REMINDER",
  "ATTENDANCE_FEEDBACK",
  "PAYMENT_SUCCEEDED",
  "PAYMENT_FAILED",
  "REFUND_ISSUED",
  "CLUB_INVITE",
  "NEW_FOLLOWER",
  "FOLLOW_REQUEST",
  "POST_LIKED",
  "POST_COMMENTED",
  "COMMENT_REPLIED",
  "COMMENT_LIKED",
  "NEW_MESSAGE",
  "SYSTEM",
]);

/** Union types for app code, e.g. `UserRole` instead of a string. */
export type UserRole = (typeof userRole.enumValues)[number];
export type ClubRole = (typeof clubRole.enumValues)[number];
export type SessionStatus = (typeof sessionStatus.enumValues)[number];
