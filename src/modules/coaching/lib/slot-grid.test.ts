import { describe, expect, it } from "vitest";

import { zonedToUtc } from "@/modules/clubs/lib/zoned-time";

import { buildCoachGrid } from "./slot-grid";

const LISBON = "Europe/Lisbon";
const MADRID = "Europe/Madrid";
const at = (day: string, time: string, tz: string) => {
  const [h, m] = time.split(":").map(Number);
  return zonedToUtc(day, h! * 60 + m!, tz)!;
};
const slot = (clubId: string, tz: string, day: string, from: string, to: string) => ({ clubId, startsAt: at(day, from, tz), endsAt: at(day, to, tz) });

const clubs = [
  { id: "porto", name: "Padel Central, Porto", timeZone: LISBON },
  { id: "madrid", name: "Club Madrid", timeZone: MADRID },
  { id: "unused", name: "Nowhere", timeZone: LISBON },
];

describe("buildCoachGrid", () => {
  const grid = buildCoachGrid({
    open: [
      { ...slot("porto", LISBON, "2026-11-19", "09:00", "10:00"), facilityIds: ["f1"] },
      { ...slot("porto", LISBON, "2026-11-19", "11:00", "12:00"), facilityIds: ["f1"] },
      { ...slot("madrid", MADRID, "2026-11-19", "09:00", "10:00"), facilityIds: ["f9"] },
      { ...slot("porto", LISBON, "2026-11-21", "16:00", "17:00"), facilityIds: ["f1"] },
    ],
    taken: [slot("porto", LISBON, "2026-11-18", "16:00", "17:00"), slot("porto", LISBON, "2026-11-19", "10:00", "11:00")],
    clubs,
  });

  it("lists every day with something on it, and starts on the first open one", () => {
    expect(grid.days).toEqual(["2026-11-18", "2026-11-19", "2026-11-21"]);
    expect(grid.firstOpenDay).toBe("2026-11-19");
  });

  it("has a column per club the coach teaches at that has slots", () => {
    expect(grid.columns.map((c) => c.id)).toEqual(["porto", "madrid"]);
  });

  it("has a row per start time, in each club's local time", () => {
    const rows = grid.rowsFor("2026-11-19");
    expect(rows.map((r) => r.time)).toEqual(["09:00", "10:00", "11:00"]);
    expect(rows[0]!.cells).toEqual([
      { state: "available", startTime: "09:00", endTime: "10:00", startsAt: at("2026-11-19", "09:00", LISBON).toISOString() },
      { state: "available", startTime: "09:00", endTime: "10:00", startsAt: at("2026-11-19", "09:00", MADRID).toISOString() },
    ]);
    expect(rows[1]!.cells).toEqual([{ state: "booked" }, { state: "unavailable" }]);
    expect(rows[2]!.cells[1]).toEqual({ state: "unavailable" });
  });

  it("shows a day that only has taken slots as booked", () => {
    expect(grid.rowsFor("2026-11-18")).toEqual([{ time: "16:00", cells: [{ state: "booked" }, { state: "unavailable" }] }]);
    expect(grid.rowsFor("2026-11-20")).toEqual([]);
  });

  it("is empty without slots", () => {
    expect(buildCoachGrid({ open: [], taken: [], clubs })).toMatchObject({ days: [], firstOpenDay: null, columns: [] });
  });
});
