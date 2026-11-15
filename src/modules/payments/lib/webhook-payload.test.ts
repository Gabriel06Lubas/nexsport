import { describe, expect, it } from "vitest";

import { isThinPayload, thinActionFor } from "./webhook-payload";

describe("isThinPayload", () => {
  it("tells thin notifications from snapshot events", () => {
    expect(isThinPayload({ id: "evt_1", object: "v2.core.event", type: "v2.core.account.updated", related_object: { id: "acct_1" } })).toBe(true);
    expect(isThinPayload({ id: "evt_1", object: "event", type: "account.updated", data: { object: { id: "acct_1" } } })).toBe(false);
  });
  it("treats a notification without `object` as thin (the SDK accepts those)", () => {
    expect(isThinPayload({ id: "evt_1", type: "v2.core.account.updated", related_object: { id: "acct_1" } })).toBe(true);
  });
  it("keeps a snapshot event without `object` a snapshot event", () => {
    expect(isThinPayload({ id: "evt_1", type: "payment_intent.succeeded", data: { object: {} } })).toBe(false);
    expect(isThinPayload(null)).toBe(false);
    expect(isThinPayload("x")).toBe(false);
  });
});

describe("thinActionFor", () => {
  const n = (type: string, id: string | null = "acct_1") => ({ type, related_object: id ? { id, type: "v2.core.account" } : null });
  it("re-reads the account for v2 account events, including the bracketed ones", () => {
    expect(thinActionFor(n("v2.core.account.updated"))).toEqual({ kind: "account-changed", accountId: "acct_1" });
    expect(thinActionFor(n("v2.core.account[requirements].updated"))).toEqual({ kind: "account-changed", accountId: "acct_1" });
    expect(thinActionFor(n("v2.core.account[configuration.merchant].capability_status_updated"))).toEqual({ kind: "account-changed", accountId: "acct_1" });
    expect(thinActionFor(n("v1.account.updated"))).toEqual({ kind: "account-changed", accountId: "acct_1" });
  });
  it("disconnects a closed account", () => {
    expect(thinActionFor(n("v2.core.account.closed"))).toEqual({ kind: "account-closed", accountId: "acct_1" });
  });
  it("ignores everything else, with a reason", () => {
    expect(thinActionFor(n("v2.core.account_link.returned")).kind).toBe("ignore");
    expect(thinActionFor(n("v2.core.account_person.created")).kind).toBe("ignore");
    expect(thinActionFor(n("v1.payment_intent.succeeded", "pi_1")).kind).toBe("ignore");
    expect(thinActionFor(n("v2.core.account.updated", null)).kind).toBe("ignore");
    expect(thinActionFor(n("v2.core.account.updated", "pi_1")).kind).toBe("ignore");
  });
});
