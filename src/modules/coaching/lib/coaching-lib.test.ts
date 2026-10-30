import { describe, expect, it } from "vitest";

import { formValues } from "@/lib/action-state";
import { zonedToUtc } from "@/modules/clubs/lib/zoned-time";

import { availabilitySchema, profileSchema, sessionSchema } from "./forms";
import { openSlots, type SlotFacility } from "./slots";

const MADRID = "Europe/Madrid";
const at = (date: string, hhmm: string) => zonedToUtc(date, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)), MADRID)!;
const iv = (date: string, from: string, to: string) => ({ start: at(date, from).getTime(), end: at(date, to).getTime() });

describe("openSlots", () => {
  // 2026-11-01 is a Sunday; the window is Mondays 17:00–20:00 at club c1.
  const base = {
    windows: [{ clubId: "c1", timeZone: MADRID, facilityId: null, dayOfWeek: 1, startMinute: 17 * 60, endMinute: 20 * 60 }],
    facilities: [
      { id: "f1", clubId: "c1", openMinute: 7 * 60, closeMinute: 23 * 60 },
      { id: "f2", clubId: "c1", openMinute: 7 * 60, closeMinute: 19 * 60 },
      { id: "fx", clubId: "c2", openMinute: 0, closeMinute: 1440 },
    ] satisfies SlotFacility[],
    sessionMinutes: 60,
    now: at("2026-11-01", "12:00"),
    minNoticeHours: 12,
    maxAdvanceDays: 7,
    coachBusy: [],
    facilityBusy: new Map(),
  };
  const times = (slots: ReturnType<typeof openSlots>) => slots.map((s) => s.startsAt.toISOString());

  it("cuts windows into session-length slots on the right weekday, in the club's zone", () => {
    const slots = openSlots(base);
    expect(times(slots)).toEqual([at("2026-11-02", "17:00"), at("2026-11-02", "18:00"), at("2026-11-02", "19:00")].map((d) => d.toISOString()));
    expect(slots[0]!.facilityIds).toEqual(["f1", "f2"]);
    expect(slots[2]!.facilityIds).toEqual(["f1"]); // f2 closes at 19:00
  });

  it("drops slots when the coach is busy, and facilities that are booked", () => {
    const slots = openSlots({ ...base, coachBusy: [iv("2026-11-02", "18:30", "19:30")], facilityBusy: new Map([["f1", [iv("2026-11-02", "17:00", "18:00")]]]) });
    expect(times(slots)).toEqual([at("2026-11-02", "17:00").toISOString()]);
    expect(slots[0]!.facilityIds).toEqual(["f2"]);
  });

  it("respects the notice period, the horizon and the preferred facility", () => {
    expect(openSlots({ ...base, minNoticeHours: 30 }).length).toBe(2); // 18:00 and 19:00 are ≥ 30h away
    expect(openSlots({ ...base, maxAdvanceDays: 0 })).toEqual([]);
    expect(openSlots({ ...base, maxAdvanceDays: 9 }).length).toBe(6); // two Mondays
    const preferred = openSlots({ ...base, windows: [{ ...base.windows[0]!, facilityId: "f2" }] });
    expect(preferred.map((s) => s.facilityIds)).toEqual([["f2"], ["f2"]]);
  });

  it("offers nothing when every facility is taken", () => {
    const busy = new Map([
      ["f1", [iv("2026-11-02", "00:00", "23:59")]],
      ["f2", [iv("2026-11-02", "00:00", "23:59")]],
    ]);
    expect(openSlots({ ...base, facilityBusy: busy })).toEqual([]);
  });
});

describe("coach forms", () => {
  const fd = (entries: [string, string][]) => {
    const data = new FormData();
    for (const [k, v] of entries) data.append(k, v);
    return formValues(data);
  };
  const session = (extra: [string, string][]) =>
    sessionSchema.safeParse(fd([["facilityId", "f1"], ["sportId", "sp"], ["kind", "GROUP"], ["title", "Clinic"], ["date", "2026-11-02"], ["startTime", "18:00"], ["endTime", "19:00"], ...extra]));

  it("parses a session and its optional parts", () => {
    const parsed = session([["price", "25"], ["maxParticipants", "4"]]);
    expect(parsed.success && parsed.data).toMatchObject({ price: 2500, maxParticipants: 4, studentEmail: null, equipmentId: null });
  });

  it("rejects inconsistent sessions", () => {
    expect(session([["endTime", "18:00"]]).success).toBe(false);
    expect(session([["endTime", "23:30"]]).success).toBe(false); // over 4 hours
    expect(session([["kind", "PRIVATE"], ["maxParticipants", "6"]]).success).toBe(false);
    expect(session([["equipmentId", "e1"]]).success).toBe(false); // no quantity
    expect(session([["kind", "COACHING_PLUS"]]).success).toBe(false);
  });

  it("validates the booking link", () => {
    const profile = (slug: string) =>
      profileSchema.safeParse(fd([["slug", slug], ["timezone", MADRID], ["sessionMinutes", "60"], ["minNoticeHours", "12"], ["maxAdvanceDays", "21"]]));
    expect(profile("John-Doe").success && profile("John-Doe").data?.slug).toBe("john-doe");
    expect(profile("admin").success).toBe(false);
    expect(profile("john doe").success).toBe(false);
    expect(profileSchema.safeParse(fd([["slug", "john"], ["timezone", MADRID], ["sessionMinutes", "50"], ["minNoticeHours", "12"], ["maxAdvanceDays", "21"]])).success).toBe(false);
  });

  it("parses availability windows", () => {
    const w = availabilitySchema.parse(fd([["clubId", "c1"], ["days", "1"], ["days", "3"], ["startTime", "17:00"], ["endTime", "20:00"], ["facilityId", ""]]));
    expect(w).toMatchObject({ days: [1, 3], startTime: 1020, endTime: 1200, facilityId: null });
  });
});
