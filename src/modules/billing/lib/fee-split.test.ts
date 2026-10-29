import { describe, expect, it } from "vitest";

import { estimateProcessingFee, splitSessionPayment } from "./fee-split";

describe("splitSessionPayment", () => {
  it("splits a €30 session with a 10% platform fee and a 70% coach share", () => {
    const split = splitSessionPayment({ amount: 3000, platformFeeBps: 1000, coachShareBps: 7000, processingFee: 70 });
    expect(split).toEqual({ amount: 3000, platformFee: 300, processingFee: 70, coachAmount: 1841, clubAmount: 789 });
  });

  it("never pays out more than was collected", () => {
    for (const amount of [1, 7, 99, 1001, 4999]) {
      const s = splitSessionPayment({ amount, platformFeeBps: 333, coachShareBps: 6667, processingFee: 3 });
      expect(s.platformFee + s.processingFee + s.clubAmount + s.coachAmount).toBe(amount);
      expect(s.clubAmount).toBeGreaterThanOrEqual(0);
    }
  });

  it("rejects out-of-range basis points", () => {
    expect(() => splitSessionPayment({ amount: 100, platformFeeBps: 10_001, coachShareBps: 0, processingFee: 0 })).toThrow(RangeError);
  });
});

describe("estimateProcessingFee", () => {
  it("applies percentage plus fixed fee", () => {
    expect(estimateProcessingFee(3000, 150, 25)).toBe(70);
  });
});
