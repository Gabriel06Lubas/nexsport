import { sql } from "drizzle-orm";
import { boolean, char, check, integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

import { createdAt, fk, id, idx, tstz, uniq, updatedAt } from "../columns";
import { user } from "./auth";
import { club } from "./clubs";
import {
  disputeStatus,
  paymentKind,
  paymentStatus,
  planAudience,
  refundStatus,
  stripeAccountStatus,
  stripeAccountType,
  subscriptionStatus,
  subscriptionTier,
  transferRecipientType,
  transferStatus,
} from "./enums";
import { memberPass } from "./memberships";
import { facilityBooking, practiceSession, sessionParticipant } from "./scheduling";

// =============================================================================
// BILLING (Stripe Billing for SaaS + Stripe Connect for session payouts)
// =============================================================================

/** SaaS plan for a Club OR an independent Coach (exactly one owner). */
export const subscription = pgTable(
  "Subscription",
  {
    id: id(),
    clubId: text(),
    userId: text(),
    tier: subscriptionTier().notNull(),
    status: subscriptionStatus().notNull(),
    stripeCustomerId: text().notNull(),
    stripeSubscriptionId: text().notNull(),
    stripePriceId: text().notNull(),
    /**
     * What this customer pays per month, in minor units: a snapshot taken when
     * the subscription starts or changes (Stripe webhook), so editing a plan's
     * list price never rewrites existing customers' MRR.
     */
    monthlyAmount: integer().notNull().default(0),
    currency: char({ length: 3 }).notNull().default("eur"),
    /** Platform take-rate applied to session payments while this plan is active. */
    platformFeeBps: integer().notNull().default(1000),
    currentPeriodStart: tstz().notNull(),
    currentPeriodEnd: tstz().notNull(),
    cancelAtPeriodEnd: boolean().notNull().default(false),
    canceledAt: tstz(),
    trialEndsAt: tstz(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniq("Subscription", t.stripeSubscriptionId),
    idx("Subscription", t.clubId, t.status),
    idx("Subscription", t.userId, t.status),
    // At most one live (non-terminal) subscription per owner.
    uniqueIndex("Subscription_one_live_per_club")
      .on(t.clubId)
      .where(sql`"clubId" IS NOT NULL AND "status" NOT IN ('CANCELED', 'INCOMPLETE_EXPIRED')`),
    uniqueIndex("Subscription_one_live_per_user")
      .on(t.userId)
      .where(sql`"userId" IS NOT NULL AND "status" NOT IN ('CANCELED', 'INCOMPLETE_EXPIRED')`),
    fk("Subscription", [t.clubId], [club.id]).onDelete("cascade"),
    fk("Subscription", [t.userId], [user.id]).onDelete("cascade"),
    check("Subscription_exactly_one_owner", sql`num_nonnulls("clubId", "userId") = 1`),
    check("Subscription_fee_bps", sql`"platformFeeBps" BETWEEN 0 AND 10000`),
    check("Subscription_period_order", sql`"currentPeriodEnd" >= "currentPeriodStart"`),
    check("Subscription_monthly_amount_non_negative", sql`"monthlyAmount" >= 0`),
    check("Subscription_currency_format", sql`"currency" ~ '^[a-z]{3}$'`),
  ],
);

/**
 * The SaaS plan catalogue, edited by admins in /admin/subscriptions. One row
 * per tier (seeded by migration 0004). Limits are nullable: null = unlimited.
 */
export const subscriptionPlan = pgTable(
  "SubscriptionPlan",
  {
    tier: subscriptionTier().primaryKey(),
    name: text().notNull(),
    audience: planAudience().notNull(),
    /** List price per month in minor units (cents). */
    monthlyPriceAmount: integer().notNull(),
    currency: char({ length: 3 }).notNull().default("eur"),
    /** Platform fee on pay-per-session bookings (300 = 3%). */
    platformFeeBps: integer().notNull(),
    /** Stripe Price for this plan (price_…); null for free plans. */
    stripePriceId: text(),
    maxFacilities: integer(),
    maxStaff: integer(),
    maxAthletes: integer(),
    isActive: boolean().notNull().default(true),
    updatedAt: updatedAt(),
    updatedById: text(),
  },
  (t) => [
    uniq("SubscriptionPlan", t.stripePriceId),
    fk("SubscriptionPlan", [t.updatedById], [user.id]).onDelete("set null"),
    check("SubscriptionPlan_price_non_negative", sql`"monthlyPriceAmount" >= 0`),
    check("SubscriptionPlan_fee_bps", sql`"platformFeeBps" BETWEEN 0 AND 10000`),
    check("SubscriptionPlan_currency_format", sql`"currency" ~ '^[a-z]{3}$'`),
    check("SubscriptionPlan_stripe_price_format", sql`"stripePriceId" IS NULL OR "stripePriceId" ~ '^price_[A-Za-z0-9]{8,64}$'`),
    check(
      "SubscriptionPlan_limits_positive",
      sql`("maxFacilities" IS NULL OR "maxFacilities" >= 0) AND ("maxStaff" IS NULL OR "maxStaff" >= 0) AND ("maxAthletes" IS NULL OR "maxAthletes" >= 0)`,
    ),
    check("SubscriptionPlan_paid_has_price", sql`"monthlyPriceAmount" = 0 OR "stripePriceId" IS NOT NULL OR NOT "isActive"`),
  ],
);

/** Stripe Connect connected account for a Club OR a Coach (exactly one owner). */
export const stripeAccount = pgTable(
  "StripeAccount",
  {
    id: id(),
    clubId: text(),
    userId: text(),
    /** acct_... */
    stripeAccountId: text().notNull(),
    type: stripeAccountType().notNull().default("EXPRESS"),
    status: stripeAccountStatus().notNull().default("ONBOARDING"),
    country: char({ length: 2 }).notNull(),
    defaultCurrency: char({ length: 3 }).notNull(),
    chargesEnabled: boolean().notNull().default(false),
    payoutsEnabled: boolean().notNull().default(false),
    detailsSubmitted: boolean().notNull().default(false),
    /** Mirrors `account.requirements.currently_due` from Stripe webhooks. */
    requirementsDue: text()
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    disabledReason: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniq("StripeAccount", t.clubId),
    uniq("StripeAccount", t.userId),
    uniq("StripeAccount", t.stripeAccountId),
    fk("StripeAccount", [t.clubId], [club.id]).onDelete("cascade"),
    fk("StripeAccount", [t.userId], [user.id]).onDelete("cascade"),
    check("StripeAccount_exactly_one_owner", sql`num_nonnulls("clubId", "userId") = 1`),
  ],
);

/**
 * One customer payment: a session seat (pay-per-session), a court rental or a
 * membership pass. `kind` says which; exactly that target column is set.
 *
 * Money flow ("separate charges and transfers"):
 *   amount                  charged to the student
 *   − applicationFeeAmount  kept by the platform
 *   − stripeFeeAmount       Stripe processing (known after charge)
 *   = transferred to Club / Coach via PaymentTransfer rows
 */
export const paymentTransaction = pgTable(
  "PaymentTransaction",
  {
    id: id(),
    clubId: text().notNull(),
    kind: paymentKind().notNull().default("SESSION"),
    sessionId: text(),
    participantId: text(),
    facilityBookingId: text(),
    memberPassId: text(),
    payerId: text().notNull(),
    coachId: text(),
    amount: integer().notNull(),
    currency: char({ length: 3 }).notNull(),
    applicationFeeAmount: integer().notNull().default(0),
    stripeFeeAmount: integer(),
    status: paymentStatus().notNull().default("REQUIRES_PAYMENT_METHOD"),
    stripePaymentIntentId: text().notNull(),
    stripeChargeId: text(),
    /** Stripe `transfer_group`, ties the charge to its downstream transfers. */
    transferGroup: text().notNull(),
    /** Client-supplied key so retried checkouts never double-charge. */
    idempotencyKey: text().notNull(),
    failureCode: text(),
    failureMessage: text(),
    // Refunds
    refundStatus: refundStatus().notNull().default("NONE"),
    refundedAmount: integer().notNull().default(0),
    refundReason: text(),
    /** Policy snapshot applied at refund time (rules can change later). */
    appliedRefundPercent: integer(),
    cancellationPolicyId: text(),
    // Chargebacks
    disputeStatus: disputeStatus().notNull().default("NONE"),
    stripeDisputeId: text(),
    disputedAmount: integer(),
    disputeReason: text(),
    paidAt: tstz(),
    refundedAt: tstz(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniq("PaymentTransaction", t.stripePaymentIntentId),
    uniq("PaymentTransaction", t.stripeChargeId),
    uniq("PaymentTransaction", t.idempotencyKey),
    uniq("PaymentTransaction", t.stripeDisputeId),
    idx("PaymentTransaction", t.clubId, t.createdAt),
    idx("PaymentTransaction", t.sessionId),
    idx("PaymentTransaction", t.participantId),
    idx("PaymentTransaction", t.payerId, t.createdAt),
    idx("PaymentTransaction", t.coachId, t.createdAt),
    idx("PaymentTransaction", t.status),
    // A session seat can have at most one in-flight or successful payment,
    // so a retried checkout can never charge the student twice.
    uniqueIndex("PaymentTransaction_one_live_per_participant")
      .on(t.participantId)
      .where(sql`"status" NOT IN ('CANCELED', 'FAILED')`),
    uniqueIndex("PaymentTransaction_one_live_per_facility_booking")
      .on(t.facilityBookingId)
      .where(sql`"status" NOT IN ('CANCELED', 'FAILED')`),
    uniqueIndex("PaymentTransaction_one_live_per_member_pass")
      .on(t.memberPassId)
      .where(sql`"status" NOT IN ('CANCELED', 'FAILED')`),
    idx("PaymentTransaction", t.clubId, t.kind, t.paidAt),
    fk("PaymentTransaction", [t.clubId], [club.id]).onDelete("restrict"),
    fk("PaymentTransaction", [t.sessionId], [practiceSession.id]).onDelete("restrict"),
    fk("PaymentTransaction", [t.participantId], [sessionParticipant.id]).onDelete("restrict"),
    // Composite FKs: a rental or pass can only be paid to the club that owns it.
    fk("PaymentTransaction", [t.facilityBookingId, t.clubId], [facilityBooking.id, facilityBooking.clubId]).onDelete("restrict"),
    fk("PaymentTransaction", [t.memberPassId, t.clubId], [memberPass.id, memberPass.clubId]).onDelete("restrict"),
    fk("PaymentTransaction", [t.payerId], [user.id]).onDelete("restrict"),
    fk("PaymentTransaction", [t.coachId], [user.id]).onDelete("set null"),
    fk("PaymentTransaction", [t.cancellationPolicyId], [cancellationPolicy.id]).onDelete("set null"),
    check(
      "PaymentTransaction_kind_target",
      sql`CASE "kind"
        WHEN 'SESSION' THEN num_nonnulls("sessionId", "participantId") = 2 AND num_nonnulls("facilityBookingId", "memberPassId") = 0
        WHEN 'COURT_RENTAL' THEN "facilityBookingId" IS NOT NULL AND num_nonnulls("sessionId", "participantId", "memberPassId") = 0
        WHEN 'MEMBERSHIP' THEN "memberPassId" IS NOT NULL AND num_nonnulls("sessionId", "participantId", "facilityBookingId") = 0
      END`,
    ),
    check("PaymentTransaction_amount_positive", sql`"amount" > 0`),
    check("PaymentTransaction_currency_format", sql`"currency" ~ '^[a-z]{3}$'`),
    check("PaymentTransaction_fee_bounds", sql`"applicationFeeAmount" >= 0 AND "applicationFeeAmount" <= "amount"`),
    check("PaymentTransaction_stripe_fee_non_negative", sql`"stripeFeeAmount" IS NULL OR "stripeFeeAmount" >= 0`),
    check("PaymentTransaction_refund_bounds", sql`"refundedAmount" >= 0 AND "refundedAmount" <= "amount"`),
    check(
      "PaymentTransaction_refund_percent",
      sql`"appliedRefundPercent" IS NULL OR "appliedRefundPercent" BETWEEN 0 AND 100`,
    ),
    check(
      "PaymentTransaction_dispute_amount",
      sql`"disputedAmount" IS NULL OR ("disputedAmount" > 0 AND "disputedAmount" <= "amount")`,
    ),
  ],
);

/**
 * A Stripe Transfer from the platform balance to a connected account
 * (the club's share and, optionally, the coach's share of a payment).
 */
export const paymentTransfer = pgTable(
  "PaymentTransfer",
  {
    id: id(),
    paymentId: text().notNull(),
    /** FK → StripeAccount.id */
    stripeAccountId: text().notNull(),
    recipientType: transferRecipientType().notNull(),
    amount: integer().notNull(),
    currency: char({ length: 3 }).notNull(),
    status: transferStatus().notNull().default("PENDING"),
    /** tr_... */
    stripeTransferId: text(),
    reversedAmount: integer().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniq("PaymentTransfer", t.stripeTransferId),
    uniq("PaymentTransfer", t.paymentId, t.recipientType),
    idx("PaymentTransfer", t.stripeAccountId, t.createdAt),
    fk("PaymentTransfer", [t.paymentId], [paymentTransaction.id]).onDelete("cascade"),
    fk("PaymentTransfer", [t.stripeAccountId], [stripeAccount.id]).onDelete("restrict"),
    check("PaymentTransfer_amount_positive", sql`"amount" > 0`),
    check("PaymentTransfer_reversal_bounds", sql`"reversedAmount" >= 0 AND "reversedAmount" <= "amount"`),
  ],
);

/**
 * Club-defined refund rules applied automatically when a participant cancels.
 * Rules are evaluated from the largest `minHoursBeforeStart` downward; the
 * first rule whose threshold is met wins. No match ⇒ 0% refund.
 */
export const cancellationPolicy = pgTable(
  "CancellationPolicy",
  {
    id: id(),
    clubId: text().notNull(),
    /** "Flexible", "Standard 24h", "Strict" */
    name: text().notNull(),
    description: text(),
    isDefault: boolean().notNull().default(false),
    /** Refund when the *club/coach* cancels the session (normally 100%). */
    organizerCancelRefundPercent: integer().notNull().default(100),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniq("CancellationPolicy", t.clubId, t.name),
    // At most one default policy per club.
    uniqueIndex("CancellationPolicy_one_default_per_club").on(t.clubId).where(sql`"isDefault"`),
    fk("CancellationPolicy", [t.clubId], [club.id]).onDelete("cascade"),
    check("CancellationPolicy_organizer_refund_percent", sql`"organizerCancelRefundPercent" BETWEEN 0 AND 100`),
  ],
);

export const cancellationPolicyRule = pgTable(
  "CancellationPolicyRule",
  {
    id: id(),
    policyId: text().notNull(),
    /** e.g. 48 → "cancelled ≥ 48h before start". */
    minHoursBeforeStart: integer().notNull(),
    /** 0–100 */
    refundPercent: integer().notNull(),
  },
  (t) => [
    uniq("CancellationPolicyRule", t.policyId, t.minHoursBeforeStart),
    fk("CancellationPolicyRule", [t.policyId], [cancellationPolicy.id]).onDelete("cascade"),
    check("CancellationPolicyRule_hours_non_negative", sql`"minHoursBeforeStart" >= 0`),
    check("CancellationPolicyRule_percent_range", sql`"refundPercent" BETWEEN 0 AND 100`),
  ],
);

/** Stripe webhook idempotency log: insert `event.id` first, skip if it exists. */
export const stripeWebhookEvent = pgTable(
  "StripeWebhookEvent",
  {
    /** evt_... */
    id: text().primaryKey(),
    type: text().notNull(),
    livemode: boolean().notNull(),
    processedAt: tstz(),
    error: text(),
    createdAt: createdAt(),
  },
  (t) => [idx("StripeWebhookEvent", t.type, t.createdAt)],
);
