import { describe, expect, it } from "vitest";

import { computeRefund } from "./refund-policy";

const standard = {
  organizerCancelRefundPercent: 100,
  rules: [
    { minHoursBeforeStart: 2, refundPercent: 0 },
    { minHoursBeforeStart: 48, refundPercent: 100 },
    { minHoursBeforeStart: 24, refundPercent: 50 },
  ],
};

describe("computeRefund", () => {
  it("picks the largest notice period that was met", () => {
    expect(computeRefund(standard, 3000, 72, "PARTICIPANT").refundAmount).toBe(3000);
    expect(computeRefund(standard, 3000, 30, "PARTICIPANT").refundAmount).toBe(1500);
    expect(computeRefund(standard, 3000, 5, "PARTICIPANT").refundPercent).toBe(0);
  });

  it("refunds nothing when no rule applies", () => {
    expect(computeRefund(standard, 3000, 1, "PARTICIPANT")).toEqual({ refundPercent: 0, refundAmount: 0, rule: null });
  });

  it("uses the organizer rate when the club cancels", () => {
    expect(computeRefund(standard, 3000, 0, "ORGANIZER").refundAmount).toBe(3000);
  });
});
