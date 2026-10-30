// Stripe Connect status shown as one badge per tenant.

export type ConnectState = "active" | "restricted" | "onboarding" | "not_connected";

export function connectState(account: {
  status: string | null;
  chargesEnabled: boolean | null;
  payoutsEnabled: boolean | null;
} | null): ConnectState {
  if (!account || account.status === null) return "not_connected";
  if (account.chargesEnabled && account.payoutsEnabled) return "active";
  if (account.status === "RESTRICTED" || account.status === "REJECTED") return "restricted";
  return "onboarding";
}

export const connectLabels: Record<ConnectState, string> = {
  active: "Connected",
  restricted: "Restricted",
  onboarding: "Onboarding",
  not_connected: "Not connected",
};

/** Share of accounts able to both charge and pay out, 0–100, or null with no accounts. */
export function connectHealthPercent(total: number, healthy: number): number | null {
  return total === 0 ? null : Math.round((healthy / total) * 1000) / 10;
}
