// What a Stripe Connect account's state means for nexport, from the fields
// Stripe sends on an Accounts v2 object (GET /v2/core/accounts/:id with
// configuration.merchant, configuration.recipient and requirements included).
// Pure, so it's unit tested and shared by the webhook and the pages.
//
//   charges    = merchant card_payments capability active (destination charges)
//   transfers  = recipient stripe_balance.stripe_transfers active (seat shares)
//   payouts    = stripe_balance.payouts active (merchant or recipient)
//   requirements due = entries waiting on the owner (currently or past due)

export type ConnectStatus = "ONBOARDING" | "PENDING_VERIFICATION" | "ACTIVE" | "RESTRICTED" | "REJECTED";

type Capability = { status?: string | null; status_details?: { code?: string | null; resolution?: string | null }[] | null } | null | undefined;

export type AccountFacts = {
  closed?: boolean | null;
  configuration?: {
    merchant?: { capabilities?: { card_payments?: Capability; stripe_balance?: { payouts?: Capability } | null } | null } | null;
    recipient?: { capabilities?: { stripe_balance?: { payouts?: Capability; stripe_transfers?: Capability } | null } | null } | null;
  } | null;
  requirements?: {
    entries?: { awaiting_action_from?: string | null; description?: string | null; minimum_deadline?: { status?: string | null } | null }[] | null;
  } | null;
};

export type ConnectState = {
  status: ConnectStatus;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  transfersEnabled: boolean;
  detailsSubmitted: boolean;
  requirementsDue: string[];
  disabledReason: string | null;
};

const due = new Set(["currently_due", "past_due"]);

/**
 * `submittedBefore`: the stored detailsSubmitted. v2 has no such flag, so it
 * turns on once nothing is left for the owner, and stays on: requirements
 * Stripe adds later read as "update details", not as unfinished onboarding.
 */
export function connectStateOf(a: AccountFacts, { submittedBefore = false } = {}): ConnectState {
  const merchant = a.configuration?.merchant?.capabilities;
  const recipient = a.configuration?.recipient?.capabilities?.stripe_balance;
  const caps: Capability[] = [merchant?.card_payments, merchant?.stripe_balance?.payouts, recipient?.payouts, recipient?.stripe_transfers];

  const chargesEnabled = merchant?.card_payments?.status === "active";
  const transfersEnabled = recipient?.stripe_transfers?.status === "active";
  const payoutsEnabled = merchant?.stripe_balance?.payouts?.status === "active" || recipient?.payouts?.status === "active";

  const entries = a.requirements?.entries ?? [];
  const requirementsDue = [
    ...new Set(entries.filter((e) => e.awaiting_action_from !== "stripe" && due.has(e.minimum_deadline?.status ?? "")).map((e) => e.description ?? "").filter(Boolean)),
  ].sort();
  // Nothing left for the owner to fill in (Stripe may still be reviewing it).
  const detailsSubmitted = submittedBefore || requirementsDue.length === 0;

  // A closed account can't be used again, like one that disconnected nexport.
  if (a.closed) return { status: "RESTRICTED", chargesEnabled: false, payoutsEnabled: false, transfersEnabled: false, detailsSubmitted, requirementsDue, disabledReason: DISCONNECTED };

  const codes = caps.flatMap((c) => c?.status_details ?? []).map((d) => d.code ?? "");
  const rejected = caps.some((c) => c?.status === "rejected");
  const disabledReason = rejected ? (codes.find((c) => c.startsWith("rejected")) ?? "rejected") : (codes.find((c) => c && c !== "determining_status") ?? null);

  const status: ConnectStatus = rejected
    ? "REJECTED"
    : chargesEnabled && payoutsEnabled
      ? "ACTIVE"
      : !detailsSubmitted
        ? "ONBOARDING"
        : requirementsDue.length > 0 || (disabledReason !== null && disabledReason !== "requirements_pending_verification")
          ? "RESTRICTED"
          : "PENDING_VERIFICATION";
  return { status, chargesEnabled, payoutsEnabled, transfersEnabled, detailsSubmitted, requirementsDue, disabledReason };
}

/** What the owner should do next, for the button on Billing / Earnings. */
export type ConnectNextStep = "connect" | "continue" | "update" | "dashboard";

/** The owner disconnected nexport in Stripe: that account can't be used again; a new one is needed. */
export const DISCONNECTED = "platform_disconnected";

export function connectNextStep(account: { detailsSubmitted: boolean; requirementsDue: string[]; status: ConnectStatus; disabledReason?: string | null } | null): ConnectNextStep {
  if (!account || account.disabledReason === DISCONNECTED) return "connect";
  if (!account.detailsSubmitted) return "continue";
  if (account.status === "RESTRICTED" || account.requirementsDue.length > 0) return "update";
  return "dashboard";
}

/**
 * A refund of `refundedTotal` (cumulative) on a payment of `paymentAmount`
 * takes back the same fraction of each share sent to a club or coach.
 * Returns how much more of this transfer to reverse now.
 */
export function reversalDue(transfer: { amount: number; reversedAmount: number }, refundedTotal: number, paymentAmount: number): number {
  if (paymentAmount <= 0 || refundedTotal <= 0) return 0;
  const target = Math.min(transfer.amount, Math.round((transfer.amount * Math.min(refundedTotal, paymentAmount)) / paymentAmount));
  return Math.max(0, target - transfer.reversedAmount);
}
