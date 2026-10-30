import { describe, expect, it } from "vitest";

import { formValues } from "@/lib/action-state";

import { addStaffSchema, bookingSchema, createClubSchema, facilitySchema, membershipPlanSchema, permissionsSchema, priceRuleSchema } from "./forms";
import { canOpenSection, hasPermission, slugify } from "./permissions";
import { quoteBooking, type PriceRule } from "./pricing";
import { isoDowOf, minuteToTime, timeToMinute, zonedParts, zonedToUtc } from "./zoned-time";

const MADRID = "Europe/Madrid";

describe("zoned time", () => {
  it("converts local wall-clock time to UTC in summer and winter", () => {
    expect(zonedToUtc("2026-07-01", 18 * 60, MADRID)?.toISOString()).toBe("2026-07-01T16:00:00.000Z");
    expect(zonedToUtc("2026-01-15", 18 * 60, MADRID)?.toISOString()).toBe("2026-01-15T17:00:00.000Z");
    expect(zonedToUtc("2026-01-15", 1440, MADRID)?.toISOString()).toBe("2026-01-15T23:00:00.000Z");
  });

  it("rejects local times skipped by daylight saving, and impossible dates", () => {
    // 2026-03-29 02:00-03:00 doesn't exist in Madrid.
    expect(zonedToUtc("2026-03-29", 2 * 60 + 30, MADRID)).toBeNull();
    expect(zonedToUtc("2026-02-30", 600, MADRID)).toBeNull();
    expect(zonedToUtc("2026-03-29", 3 * 60, MADRID)?.toISOString()).toBe("2026-03-29T01:00:00.000Z");
  });

  it("reads weekday and minute of day in the zone", () => {
    const parts = zonedParts(new Date("2026-10-30T23:30:00Z"), MADRID); // Saturday 00:30 local
    expect(parts).toMatchObject({ isoDow: 6, minuteOfDay: 30, dateKey: "2026-10-31" });
    expect(isoDowOf("2026-11-01")).toBe(7);
  });

  it("parses and formats HH:MM", () => {
    expect(timeToMinute("18:15")).toBe(1095);
    expect(timeToMinute("24:00")).toBe(1440);
    expect(timeToMinute("24:30")).toBeNull();
    expect(timeToMinute("7:00")).toBeNull();
    expect(minuteToTime(1095)).toBe("18:15");
  });
});

describe("dynamic pricing", () => {
  const rules: PriceRule[] = [
    { dayOfWeek: 3, startMinute: 18 * 60, endMinute: 22 * 60, tier: "PEAK", hourlyRateAmount: 3200 },
    { dayOfWeek: 3, startMinute: 8 * 60, endMinute: 12 * 60, tier: "OFF_PEAK", hourlyRateAmount: 1600 },
  ];
  const at = (time: string) => zonedToUtc("2026-11-04", timeToMinute(time)!, MADRID)!; // a Wednesday

  it("charges each slot at the window it starts in", () => {
    const quote = quoteBooking({ startsAt: at("17:30"), endsAt: at("19:00"), timeZone: MADRID, standardRate: 2400, rules });
    expect(quote.lines).toEqual([
      { tier: "STANDARD", hourlyRate: 2400, minutes: 30, amount: 1200 },
      { tier: "PEAK", hourlyRate: 3200, minutes: 60, amount: 3200 },
    ]);
    expect(quote.total).toBe(4400);
  });

  it("uses off-peak rates and the standard rate on days without rules", () => {
    expect(quoteBooking({ startsAt: at("10:00"), endsAt: at("11:30"), timeZone: MADRID, standardRate: 2400, rules }).total).toBe(2400);
    const thursday = (t: string) => zonedToUtc("2026-11-05", timeToMinute(t)!, MADRID)!;
    expect(quoteBooking({ startsAt: thursday("19:00"), endsAt: thursday("20:00"), timeZone: MADRID, standardRate: 2400, rules }).total).toBe(2400);
  });

  it("rejects bookings off the 15-minute grid", () => {
    expect(() => quoteBooking({ startsAt: at("10:00"), endsAt: new Date(at("10:00").getTime() + 10 * 60_000), timeZone: MADRID, standardRate: 0, rules })).toThrow(RangeError);
  });
});

describe("permissions", () => {
  it("gives owners everything and staff only what they were granted", () => {
    expect(hasPermission({ role: "OWNER", permissions: [] }, "MANAGE_BILLING")).toBe(true);
    const frontDesk = { role: "STAFF" as const, permissions: ["MANAGE_SCHEDULE" as const] };
    expect(hasPermission(frontDesk, "MANAGE_BILLING")).toBe(false);
    expect(canOpenSection(frontDesk, "schedule")).toBe(true);
    expect(canOpenSection(frontDesk, "billing")).toBe(false);
    expect(canOpenSection(frontDesk, "overview")).toBe(true);
  });

  it("slugifies names", () => {
    expect(slugify("  Pádel Central — Valencia! ")).toBe("padel-central-valencia");
  });
});

describe("forms", () => {
  const fd = (entries: [string, string][]) => {
    const data = new FormData();
    for (const [k, v] of entries) data.append(k, v);
    return formValues(data);
  };

  it("parses a facility with opening hours and an optional rate", () => {
    const parsed = facilitySchema.parse(fd([["name", "Court 1"], ["type", "PADEL_COURT"], ["surface", ""], ["isIndoor", "on"], ["capacity", ""], ["standardRate", "24"], ["openTime", "07:00"], ["closeTime", "23:00"]]));
    expect(parsed).toMatchObject({ isIndoor: true, hasLighting: false, surface: null, capacity: null, standardRate: 2400, openTime: 420, closeTime: 1380 });
    expect(facilitySchema.safeParse(fd([["name", "Court 1"], ["type", "PADEL_COURT"], ["openTime", "23:00"], ["closeTime", "07:00"]])).success).toBe(false);
  });

  it("parses repeated checkboxes and rejects unknown values", () => {
    const rule = priceRuleSchema.parse(fd([["facilityId", "abc123"], ["days", "1"], ["days", "5"], ["days", "1"], ["startTime", "18:00"], ["endTime", "22:00"], ["tier", "PEAK"], ["rate", "32"]]));
    expect(rule.days).toEqual([1, 5]);
    expect(priceRuleSchema.safeParse(fd([["facilityId", "abc123"], ["days", "8"], ["startTime", "18:00"], ["endTime", "22:00"], ["tier", "PEAK"], ["rate", "32"]])).success).toBe(false);
    expect(priceRuleSchema.safeParse(fd([["facilityId", "abc123"], ["days", "1"], ["startTime", "18:10"], ["endTime", "22:00"], ["tier", "PEAK"], ["rate", "32"]])).success).toBe(false);
    expect(permissionsSchema.safeParse(fd([["memberId", "m1"], ["permissions", "MANAGE_BILLING"], ["permissions", "SUPERUSER"]])).success).toBe(false);
    expect(permissionsSchema.parse(fd([["memberId", "m1"]])).permissions).toEqual([]);
  });

  it("rejects hostile text and malformed ids", () => {
    expect(bookingSchema.safeParse(fd([["facilityId", "f1'; DROP TABLE"], ["date", "2026-11-04"], ["startTime", "10:00"], ["endTime", "11:00"], ["customerName", "Ana"], ["paymentMethod", "ON_SITE"]])).success).toBe(false);
    const rtl = `Ana${String.fromCharCode(0x202e)}gpj.exe`;
    expect(bookingSchema.safeParse(fd([["facilityId", "f1"], ["date", "2026-11-04"], ["startTime", "10:00"], ["endTime", "11:00"], ["customerName", rtl], ["paymentMethod", "ON_SITE"]])).success).toBe(false);
    expect(bookingSchema.safeParse(fd([["facilityId", "f1"], ["date", "2026-11-04"], ["startTime", "10:00"], ["endTime", "11:00"], ["paymentMethod", "ONLINE"], ["customerName", "Ana"]])).success).toBe(false);
  });

  it("requires a customer and a sensible duration for bookings", () => {
    const base: [string, string][] = [["facilityId", "f1"], ["date", "2026-11-04"], ["startTime", "10:00"], ["paymentMethod", "ON_SITE"]];
    expect(bookingSchema.safeParse(fd([...base, ["endTime", "11:00"]])).success).toBe(false);
    expect(bookingSchema.safeParse(fd([...base, ["endTime", "10:15"], ["customerName", "Ana"]])).success).toBe(false);
    expect(bookingSchema.parse(fd([...base, ["endTime", "11:30"], ["customerEmail", " Ana@Example.com "]])).customerEmail).toBe("ana@example.com");
  });

  it("matches credits to the plan kind", () => {
    const plan = (kind: string, credits: string) => fd([["name", "Pass"], ["kind", kind], ["price", "90"], ["durationDays", "90"], ["creditCount", credits]]);
    expect(membershipPlanSchema.safeParse(plan("CREDITS", "10")).success).toBe(true);
    expect(membershipPlanSchema.safeParse(plan("CREDITS", "")).success).toBe(false);
    expect(membershipPlanSchema.safeParse(plan("UNLIMITED", "10")).success).toBe(false);
  });

  it("requires pay terms that match the employment type", () => {
    const staff = (type: string, wage: string, commission: string) => fd([["email", "c@x.dev"], ["role", "COACH"], ["employmentType", type], ["hourlyWage", wage], ["commission", commission]]);
    expect(addStaffSchema.safeParse(staff("EMPLOYEE", "15", "")).success).toBe(true);
    expect(addStaffSchema.safeParse(staff("FREELANCE", "", "70")).success).toBe(true);
    expect(addStaffSchema.safeParse(staff("FREELANCE", "15", "")).success).toBe(false);
  });

  it("refuses reserved and malformed club slugs and unknown time zones", () => {
    const club = (slug: string, timezone = MADRID) => fd([["name", "Club"], ["slug", slug], ["country", "ES"], ["timezone", timezone], ["currency", "eur"]]);
    expect(createClubSchema.safeParse(club("padel-central")).success).toBe(true);
    expect(createClubSchema.safeParse(club("settings")).success).toBe(false);
    expect(createClubSchema.safeParse(club("Padel--x")).success).toBe(false);
    expect(createClubSchema.safeParse(club("padel-central", "Mars/Olympus")).success).toBe(false);
  });
});
