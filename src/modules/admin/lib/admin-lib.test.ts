import { describe, expect, it } from "vitest";

import { connectHealthPercent, connectState } from "@/lib/connect-status";
import { escapeLike, parseListParams, pickParam } from "@/lib/list-params";
import { moneySchema, percentSchema, planFormSchema } from "./plan-form";

describe("parseListParams", () => {
  it("clamps and cleans", () => {
    expect(parseListParams({ q: "  padel ", page: "3" })).toEqual({ q: "padel", page: 3 });
    expect(parseListParams({ q: ["a", "b"], page: ["2"] })).toEqual({ q: "a", page: 2 });
    expect(parseListParams({ page: "-4" }).page).toBe(1);
    expect(parseListParams({ page: "1e9" }).page).toBe(1);
    expect(parseListParams({ page: "abc" }).page).toBe(1);
    expect(parseListParams({ q: "x".repeat(500) }).q).toBe("");
    expect(parseListParams({ q: "a\u0000b\r\n" }).q).toBe("ab");
  });

  it("only accepts listed values for enum params", () => {
    expect(pickParam("club", ["all", "club", "coach"] as const, "all")).toBe("club");
    expect(pickParam("'; DROP TABLE x", ["all", "club"] as const, "all")).toBe("all");
  });
});

describe("escapeLike", () => {
  it("escapes wildcards and the escape character", () => {
    expect(escapeLike("50%_off\\")).toBe("50\\%\\_off\\\\");
    expect(escapeLike("padel club")).toBe("padel club");
  });
});

describe("money and percent parsing", () => {
  it.each([
    ["29", 2900],
    ["29.9", 2990],
    ["29,90", 2990],
    ["0", 0],
    ["999999.99", 99999999],
  ])("money %s → %d cents", (input, cents) => {
    expect(moneySchema.parse(input)).toBe(cents);
  });

  it.each(["-1", "1.999", "abc", "1e3", "29.90.1", "", "1000000"])("rejects money %j", (input) => {
    expect(moneySchema.safeParse(input).success).toBe(false);
  });

  it("parses percentages to basis points", () => {
    expect(percentSchema.parse("3")).toBe(300);
    expect(percentSchema.parse("3.5")).toBe(350);
    expect(percentSchema.parse("100")).toBe(10_000);
    expect(percentSchema.safeParse("100.01").success).toBe(false);
    expect(percentSchema.safeParse("-3").success).toBe(false);
  });
});

describe("planFormSchema", () => {
  const base = {
    tier: "PRO_COACH",
    name: "Pro Coach",
    monthlyPrice: "29",
    platformFee: "5",
    stripePriceId: "price_1PqABCDEFGH",
    maxFacilities: "",
    maxStaff: "0",
    maxAthletes: "500",
    isActive: "on",
    expectedUpdatedAt: "2030-01-01T00:00:00.000Z",
  };

  it("parses a valid form", () => {
    expect(planFormSchema.parse(base)).toMatchObject({
      monthlyPrice: 2900,
      platformFee: 500,
      maxFacilities: null,
      maxStaff: 0,
      maxAthletes: 500,
      isActive: true,
    });
  });

  it("requires a Stripe Price ID for an active paid plan", () => {
    expect(planFormSchema.safeParse({ ...base, stripePriceId: "" }).success).toBe(false);
    expect(planFormSchema.safeParse({ ...base, stripePriceId: "", isActive: undefined }).success).toBe(true);
    expect(planFormSchema.safeParse({ ...base, stripePriceId: "", monthlyPrice: "0" }).success).toBe(true);
  });

  it.each([
    ["tier", "SUPER_PLAN"],
    ["stripePriceId", "price_1'; DROP TABLE x;--"],
    ["stripePriceId", "prod_123456789"],
    ["name", "<b>\u202eevil</b>"],
    ["maxStaff", "-1"],
    ["maxStaff", "1.5"],
    ["expectedUpdatedAt", "yesterday"],
  ])("rejects %s = %j", (field, value) => {
    expect(planFormSchema.safeParse({ ...base, [field]: value }).success).toBe(false);
  });
});

describe("connect status", () => {
  it("summarises an account", () => {
    expect(connectState(null)).toBe("not_connected");
    expect(connectState({ status: "ACTIVE", chargesEnabled: true, payoutsEnabled: true })).toBe("active");
    expect(connectState({ status: "RESTRICTED", chargesEnabled: true, payoutsEnabled: false })).toBe("restricted");
    expect(connectState({ status: "ONBOARDING", chargesEnabled: false, payoutsEnabled: false })).toBe("onboarding");
  });

  it("computes health", () => {
    expect(connectHealthPercent(0, 0)).toBeNull();
    expect(connectHealthPercent(3, 2)).toBe(66.7);
    expect(connectHealthPercent(4, 4)).toBe(100);
  });
});
