// What a Stripe Connect account's state means for nexport, from the fields
// Stripe sends on the Account object (account.updated, or a retrieve).
// Pure, so it's unit tested and shared by the webhook and the pages.

export type ConnectStatus = "ONBOARDING" | "PENDING_VERIFICATION" | "ACTIVE" | "RESTRICTED" | "REJECTED";

export type AccountFacts = {
  charges_enabled?: boolean | null;
  payouts_enabled?: boolean | null;
  details_submitted?: boolean | null;
  capabilities?: { transfers?: string | null } | null;
  requirements?: { currently_due?: string[] | null; past_due?: string[] | null; pending_verification?: string[] | null; disabled_reason?: string | null } | null;
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

export function connectStateOf(a: AccountFacts): ConnectState {
  const chargesEnabled = !!a.charges_enabled;
  const payoutsEnabled = !!a.payouts_enabled;
  const detailsSubmitted = !!a.details_submitted;
  const transfersEnabled = a.capabilities?.transfers === "active";
  const req = a.requirements ?? {};
  const requirementsDue = [...new Set([...(req.past_due ?? []), ...(req.currently_due ?? [])])].sort();
  const disabledReason = req.disabled_reason ?? null;
  const status: ConnectStatus = disabledReason?.startsWith("rejected")
    ? "REJECTED"
    : chargesEnabled && payoutsEnabled
      ? "ACTIVE"
      : !detailsSubmitted
        ? "ONBOARDING"
        : requirementsDue.length > 0 || (disabledReason !== null && disabledReason !== "requirements.pending_verification")
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
