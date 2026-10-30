import { describe, expect, it } from "vitest";

import { countdown, DEFAULT_POLICY, levelFits, refundTimeline, splitShare } from "./cancellation";
import { levelSchema, preferencesSchema } from "./forms";

const standard = {
  organizerCancelRefundPercent: 100,
  rules: [
    { minHoursBeforeStart: 24, refundPercent: 100 },
    { minHoursBeforeStart: 6, refundPercent: 50 },
    { minHoursBeforeStart: 0, refundPercent: 0 },
  ],
};
const start = new Date("2026-11-10T18:00:00Z");
const hoursBefore = (h: number) => new Date(start.getTime() - h * 3_600_000);

describe("refundTimeline", () => {
  it("shows the current refund and when it drops", () => {
    expect(refundTimeline(standard, start, hoursBefore(30))).toEqual({ percent: 100, until: hoursBefore(24), nextPercent: 50 });
    expect(refundTimeline(standard, start, hoursBefore(10))).toEqual({ percent: 50, until: hoursBefore(6), nextPercent: 0 });
    expect(refundTimeline(standard, start, hoursBefore(2))).toEqual({ percent: 0, until: null, nextPercent: null });
  });

  it("defaults to a full refund up to 24 hours before", () => {
    expect(refundTimeline(DEFAULT_POLICY, start, hoursBefore(48)).percent).toBe(100);
    expect(refundTimeline(DEFAULT_POLICY, start, hoursBefore(23)).percent).toBe(0);
  });

  it("formats countdowns", () => {
    expect(countdown(hoursBefore(0), hoursBefore(28))).toBe("1 d 4 h");
    expect(countdown(hoursBefore(0), hoursBefore(3.5))).toBe("3 h 30 min");
    expect(countdown(hoursBefore(1), hoursBefore(0))).toBe("0 min");
  });
});

describe("matchmaking", () => {
  it("matches levels to a match's range", () => {
    expect(levelFits(3.5, 3, 4)).toBe(true);
    expect(levelFits(2.5, 3, 4)).toBe(false);
    expect(levelFits(null, 3, 4)).toBe(false);
    expect(levelFits(null, null, null)).toBe(true);
  });

  it("splits a court price so the court is always covered", () => {
    expect(splitShare(4800, 4)).toBe(1200);
    expect(splitShare(5000, 3)).toBe(1667);
    expect(() => splitShare(5000, 0)).toThrow(RangeError);
  });
});

describe("student forms", () => {
  it("parses levels", () => {
    expect(levelSchema.parse("3,5")).toBe(3.5);
    expect(levelSchema.parse("")).toBeNull();
    expect(levelSchema.safeParse("11").success).toBe(false);
    expect(levelSchema.safeParse("3.55").success).toBe(false);
  });

  it("parses preferences", () => {
    expect(preferencesSchema.parse({ matchAlerts: "on", clubs: "c1,c2,c1" })).toEqual({ matchAlerts: true, bookingUpdates: false, clubs: ["c1", "c2"] });
    expect(preferencesSchema.safeParse({ clubs: "c1,DROP TABLE" }).success).toBe(false);
  });
});
