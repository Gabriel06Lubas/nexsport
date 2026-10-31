import { describe, expect, it } from "vitest";

import { zonedToUtc } from "@/modules/clubs/lib/zoned-time";

import { checkWindow, courtBookingSchema, platformFee } from "./court-booking";

const MADRID = "Europe/Madrid";
const court = { name: "Court 1", openMinute: 8 * 60, closeMinute: 22 * 60 };
const now = zonedToUtc("2026-11-02", 12 * 60, MADRID)!; // Monday noon

describe("courtBookingSchema", () => {
  const parse = (start: string, end: string) => courtBookingSchema.safeParse({ facilityId: "f1", date: "2026-11-03", startTime: start, endTime: end });
  it("accepts a 90-minute booking on the 15-minute grid", () => {
    expect(parse("18:00", "19:30").success && parse("18:00", "19:30").data).toMatchObject({ startTime: 1080, endTime: 1170 });
  });
  it("rejects off-grid, reversed, too short and too long windows", () => {
    expect(parse("18:10", "19:30").success).toBe(false);
    expect(parse("19:30", "18:00").success).toBe(false);
    expect(parse("18:00", "18:15").success).toBe(false);
    expect(parse("08:00", "12:30").success).toBe(false);
  });
  it("rejects malformed ids", () => {
    expect(courtBookingSchema.safeParse({ facilityId: "f1' OR 1=1", date: "2026-11-03", startTime: "18:00", endTime: "19:00" }).success).toBe(false);
  });
});

describe("checkWindow", () => {
  it("converts local times to instants in the club's zone", () => {
    const r = checkWindow({ date: "2026-11-03", startTime: 1080, endTime: 1170 }, court, MADRID, now);
    expect(r.ok && r.startsAt.toISOString()).toBe("2026-11-03T17:00:00.000Z");
  });
  it("enforces opening hours, notice and the booking horizon", () => {
    expect(checkWindow({ date: "2026-11-03", startTime: 1260, endTime: 1350 }, court, MADRID, now)).toMatchObject({ ok: false, field: "startTime" });
    expect(checkWindow({ date: "2026-11-02", startTime: 720, endTime: 780 }, court, MADRID, now)).toMatchObject({ ok: false, field: "date" });
    expect(checkWindow({ date: "2026-11-02", startTime: 780, endTime: 840 }, court, MADRID, now).ok).toBe(true);
    expect(checkWindow({ date: "2026-12-15", startTime: 600, endTime: 660 }, court, MADRID, now)).toMatchObject({ ok: false, field: "date" });
  });
  it("refuses local times skipped by daylight saving", () => {
    const night = { name: "Court 24h", openMinute: 0, closeMinute: 1440 };
    const march = zonedToUtc("2027-03-20", 600, MADRID)!;
    expect(checkWindow({ date: "2027-03-28", startTime: 120, endTime: 210 }, night, MADRID, march)).toMatchObject({ ok: false, field: "startTime" });
  });
});

describe("platformFee", () => {
  it("takes basis points of the amount", () => {
    expect(platformFee(4800, 300)).toBe(144); // 3%
    expect(platformFee(1999, 600)).toBe(120);
    expect(platformFee(100, 10_000)).toBe(100);
  });
  it("rejects nonsense", () => {
    expect(() => platformFee(-1, 300)).toThrow(RangeError);
    expect(() => platformFee(100, 10_001)).toThrow(RangeError);
    expect(() => platformFee(10.5, 300)).toThrow(RangeError);
  });
});
