import { pgEnum } from "drizzle-orm/pg-core";

// ---- Identity & clubs -------------------------------------------------------

/** Platform-wide role, exposed on the session for coarse RBAC.
 *  Fine-grained, per-club authority lives in `ClubMember.role`. */
/** ADMIN runs the whole SaaS; admins are created directly in the database. */
export const userRole = pgEnum("UserRole", ["ADMIN", "CLUB_OWNER", "STAFF", "COACH", "STUDENT"]);

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

/** How a club employs a staff member or coach (payroll). */
export const employmentType = pgEnum("EmploymentType", [
  "EMPLOYEE", // paid an hourly wage by the club
  "FREELANCE", // paid a commission on the sessions they run (Stripe Connect split)
]);

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

/** Dynamic pricing band for a court/field time window. */
export const priceTier = pgEnum("PriceTier", ["PEAK", "OFF_PEAK"]);

/** A court/field rental (not a coached session). */
export const facilityBookingStatus = pgEnum("FacilityBookingStatus", ["CONFIRMED", "CANCELLED"]);

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

/** SaaS plans; prices, limits and Stripe Price IDs live in SubscriptionPlan. */
export const subscriptionTier = pgEnum("SubscriptionTier", ["FREE_COACH", "PRO_COACH", "CLUB_BASIC", "CLUB_ENTERPRISE"]);

/** Who a plan is sold to. */
export const planAudience = pgEnum("PlanAudience", ["COACH", "CLUB"]);

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

/** What a payment is for; decides which booking column it points at. */
export const paymentKind = pgEnum("PaymentKind", ["SESSION", "COURT_RENTAL", "MEMBERSHIP"]);

/** How a court rental or membership pass was paid for. */
export const paymentMethod = pgEnum("PaymentMethod", [
  "ONLINE", // Stripe checkout; the money is in PaymentTransaction
  "ON_SITE", // collected at the front desk (cash / card terminal)
  "COMPLIMENTARY", // free of charge
]);

/** Membership plan shapes: time-based unlimited access, or a punch card. */
export const membershipPlanKind = pgEnum("MembershipPlanKind", ["UNLIMITED", "CREDITS"]);

export const transferRecipientType = pgEnum("TransferRecipientType", ["CLUB", "COACH"]);

export const transferStatus = pgEnum("TransferStatus", ["PENDING", "PAID", "REVERSED", "FAILED"]);

// ---- Administration ---------------------------------------------------------

/** Actions recorded in AdminAuditLog. */
export const adminAction = pgEnum("AdminAction", [
  "PLAN_UPDATED",
  "TENANT_SUSPENDED",
  "TENANT_REACTIVATED",
  "IMPERSONATION_STARTED",
  "IMPERSONATION_ENDED",
]);

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
export type SubscriptionTier = (typeof subscriptionTier.enumValues)[number];
export type ClubPermission = (typeof clubPermission.enumValues)[number];
export type ClubStatus = (typeof clubStatus.enumValues)[number];
export type FacilityType = (typeof facilityType.enumValues)[number];
export type SurfaceType = (typeof surfaceType.enumValues)[number];
export type EquipmentCondition = (typeof equipmentCondition.enumValues)[number];
export type EmploymentType = (typeof employmentType.enumValues)[number];
export type PriceTier = (typeof priceTier.enumValues)[number];
export type PaymentKind = (typeof paymentKind.enumValues)[number];
export type PaymentMethod = (typeof paymentMethod.enumValues)[number];
export type MembershipPlanKind = (typeof membershipPlanKind.enumValues)[number];
