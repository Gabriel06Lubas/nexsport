import { describe, expect, it } from "vitest";

import { connectNextStep, connectStateOf, reversalDue } from "./connect-status";

describe("connectStateOf", () => {
  it("is ONBOARDING until details are submitted", () => {
    expect(connectStateOf({ details_submitted: false, requirements: { currently_due: ["external_account"] } })).toMatchObject({ status: "ONBOARDING", chargesEnabled: false, requirementsDue: ["external_account"] });
  });
  it("is ACTIVE when charges and payouts are on", () => {
    expect(connectStateOf({ charges_enabled: true, payouts_enabled: true, details_submitted: true, capabilities: { transfers: "active" } })).toMatchObject({ status: "ACTIVE", transfersEnabled: true });
  });
  it("is PENDING_VERIFICATION while Stripe reviews submitted details", () => {
    expect(connectStateOf({ details_submitted: true, requirements: { currently_due: [], pending_verification: ["individual.id_number"], disabled_reason: "requirements.pending_verification" } }).status).toBe("PENDING_VERIFICATION");
  });
  it("is RESTRICTED when Stripe needs more (past due first, no duplicates)", () => {
    const s = connectStateOf({ charges_enabled: true, payouts_enabled: false, details_submitted: true, requirements: { past_due: ["external_account"], currently_due: ["external_account", "individual.verification.document"] } });
    expect(s.status).toBe("RESTRICTED");
    expect(s.requirementsDue).toEqual(["external_account", "individual.verification.document"]);
  });
  it("is REJECTED when Stripe rejected the account", () => {
    expect(connectStateOf({ details_submitted: true, requirements: { disabled_reason: "rejected.fraud" } }).status).toBe("REJECTED");
  });
  it("only counts an active transfers capability", () => {
    expect(connectStateOf({ capabilities: { transfers: "pending" } }).transfersEnabled).toBe(false);
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
