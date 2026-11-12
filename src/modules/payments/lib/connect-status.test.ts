import { describe, expect, it } from "vitest";

import { connectNextStep, connectStateOf, reversalDue } from "./connect-status";

// Accounts v2 objects, trimmed to what connectStateOf reads.
const cap = (status: string, code?: string) => ({ status, status_details: code ? [{ code, resolution: "provide_info" }] : [] });
const account = (o: { charges?: string; payouts?: string; transfers?: string; due?: string[]; pastDue?: string[]; reviewing?: string[]; code?: string; closed?: boolean } = {}) => ({
  closed: o.closed,
  configuration: {
    merchant: { capabilities: { card_payments: cap(o.charges ?? "restricted", o.code), stripe_balance: { payouts: cap(o.payouts ?? "restricted", o.code) } } },
    recipient: { capabilities: { stripe_balance: { stripe_transfers: cap(o.transfers ?? "restricted", o.code) } } },
  },
  requirements: {
    entries: [
      ...(o.due ?? []).map((d) => ({ awaiting_action_from: "user", description: d, minimum_deadline: { status: "currently_due" } })),
      ...(o.pastDue ?? []).map((d) => ({ awaiting_action_from: "user", description: d, minimum_deadline: { status: "past_due" } })),
      ...(o.reviewing ?? []).map((d) => ({ awaiting_action_from: "stripe", description: d, minimum_deadline: { status: "currently_due" } })),
    ],
  },
});

describe("connectStateOf", () => {
  it("is ONBOARDING while the owner still has details to give", () => {
    expect(connectStateOf(account({ due: ["external_account"], code: "requirements_past_due" }))).toMatchObject({ status: "ONBOARDING", chargesEnabled: false, detailsSubmitted: false, requirementsDue: ["external_account"] });
  });
  it("is ACTIVE when card payments and payouts are active", () => {
    expect(connectStateOf(account({ charges: "active", payouts: "active", transfers: "active" }))).toMatchObject({ status: "ACTIVE", chargesEnabled: true, payoutsEnabled: true, transfersEnabled: true, detailsSubmitted: true });
  });
  it("is PENDING_VERIFICATION while Stripe reviews submitted details", () => {
    expect(connectStateOf(account({ charges: "pending", payouts: "pending", transfers: "pending", reviewing: ["individual.id_number"], code: "requirements_pending_verification" })).status).toBe("PENDING_VERIFICATION");
  });
  it("is RESTRICTED when Stripe needs more (past due first, no duplicates)", () => {
    const s = connectStateOf(account({ charges: "active", transfers: "active", pastDue: ["external_account"], due: ["external_account", "individual.verification.document"] }), { submittedBefore: true });
    expect(s.status).toBe("RESTRICTED");
    expect(s.requirementsDue).toEqual(["external_account", "individual.verification.document"]);
  });
  it("is REJECTED when Stripe rejected a capability", () => {
    expect(connectStateOf(account({ charges: "rejected", code: "rejected_fraud" }))).toMatchObject({ status: "REJECTED", disabledReason: "rejected_fraud" });
  });
  it("treats a closed account like a disconnected one", () => {
    expect(connectStateOf(account({ charges: "active", payouts: "active", transfers: "active", closed: true }))).toMatchObject({ disabledReason: "platform_disconnected", chargesEnabled: false, transfersEnabled: false });
  });
  it("keeps details submitted once they were, so new requirements mean 'update'", () => {
    const due = account({ due: ["external_account"] });
    expect(connectStateOf(due).detailsSubmitted).toBe(false);
    expect(connectStateOf(due, { submittedBefore: true })).toMatchObject({ detailsSubmitted: true, status: "RESTRICTED" });
  });
  it("only counts an active transfers capability", () => {
    expect(connectStateOf(account({ transfers: "pending" })).transfersEnabled).toBe(false);
  });
  it("reads a sparse account (nothing included) as not set up", () => {
    expect(connectStateOf({})).toMatchObject({ chargesEnabled: false, payoutsEnabled: false, transfersEnabled: false });
  });
});

describe("connectNextStep", () => {
  it("walks connect → continue → update → dashboard", () => {
    expect(connectNextStep(null)).toBe("connect");
    expect(connectNextStep({ detailsSubmitted: false, requirementsDue: [], status: "ONBOARDING" })).toBe("continue");
    expect(connectNextStep({ detailsSubmitted: true, requirementsDue: ["external_account"], status: "RESTRICTED" })).toBe("update");
    expect(connectNextStep({ detailsSubmitted: true, requirementsDue: [], status: "ACTIVE" })).toBe("dashboard");
    // Disconnected in Stripe: start over with a new account.
    expect(connectNextStep({ detailsSubmitted: true, requirementsDue: [], status: "RESTRICTED", disabledReason: "platform_disconnected" })).toBe("connect");
  });
});

describe("reversalDue", () => {
  it("takes back the refunded fraction of a share", () => {
    expect(reversalDue({ amount: 700, reversedAmount: 0 }, 500, 1000)).toBe(350);
    expect(reversalDue({ amount: 700, reversedAmount: 350 }, 1000, 1000)).toBe(350); // a second refund tops it up
    expect(reversalDue({ amount: 700, reversedAmount: 700 }, 1000, 1000)).toBe(0);
  });
  it("never reverses more than the share, nor anything without a refund", () => {
    expect(reversalDue({ amount: 700, reversedAmount: 0 }, 5000, 1000)).toBe(700);
    expect(reversalDue({ amount: 700, reversedAmount: 0 }, 0, 1000)).toBe(0);
  });
});
