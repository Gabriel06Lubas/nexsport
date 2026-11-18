import { describe, expect, it } from "vitest";

import { zonedToUtc } from "@/modules/clubs/lib/zoned-time";

import { buildCourtGrid, gridStartMinutes, moneyLocale, parseGridDuration, type GridCourt } from "./court-grid";

const MADRID = "Europe/Madrid";
const DAY = "2026-11-03"; // a Tuesday
const now = zonedToUtc("2026-11-02", 12 * 60, MADRID)!; // the day before, noon
const at = (time: string) => {
  const [h, m] = time.split(":").map(Number);
  return zonedToUtc(DAY, h! * 60 + m!, MADRID)!;
};
const court = (over: Partial<GridCourt> = {}): GridCourt => ({
  id: "c1",
  name: "Court 1",
  openMinute: 8 * 60,
  closeMinute: 23 * 60,
  rate: 2400,
  rules: [],
  ...over,
});
const grid = (over: Partial<Parameters<typeof buildCourtGrid>[0]> = {}) =>
  buildCourtGrid({
    date: DAY,
    timeZone: MADRID,
    duration: 60,
    courts: [court()],
    busy: [],
    now,
    ...over,
  });
const cell = (rows: ReturnType<typeof grid>, time: string, i = 0) => rows.find((r) => r.time === time)!.cells[i]!;

describe("buildCourtGrid", () => {
  it("has a row every 30 minutes from 08:00 to 22:30", () => {
    const rows = grid();
    expect(rows.map((r) => r.time).slice(0, 3)).toEqual(["08:00", "08:30", "09:00"]);
    expect(rows.at(-1)!.time).toBe("22:30");
    expect(rows).toHaveLength(gridStartMinutes().length);
    expect(rows).toHaveLength(30);
  });

  it("prices an available slot for the chosen length", () => {
    expect(cell(grid(), "18:00")).toEqual({
      state: "available",
      startTime: "18:00",
      endTime: "19:00",
      amount: 2400,
    });
    expect(cell(grid({ duration: 90 }), "18:00")).toEqual({
      state: "available",
      startTime: "18:00",
      endTime: "19:30",
      amount: 3600,
    });
  });

  it("applies peak pricing from the club's rules", () => {
    const peak = court({
      rules: [
        {
          dayOfWeek: 2,
          startMinute: 18 * 60,
          endMinute: 22 * 60,
          tier: "PEAK",
          hourlyRateAmount: 3200,
        },
      ],
    });
    const rows = grid({ courts: [peak] });
    expect(cell(rows, "17:00")).toMatchObject({ amount: 2400 });
    expect(cell(rows, "17:30")).toMatchObject({ amount: 2800 }); // half standard, half peak
    expect(cell(rows, "18:00")).toMatchObject({ amount: 3200 });
  });

  it("marks taken half hours as booked, and slots that would run into them as no-fit", () => {
    const rows = grid({
      busy: [{ facilityId: "c1", startsAt: at("19:00"), endsAt: at("20:30") }],
    });
    expect(cell(rows, "19:00")).toEqual({ state: "booked" });
    expect(cell(rows, "20:00")).toEqual({ state: "booked" });
    expect(cell(rows, "20:30").state).toBe("available"); // touching the end is fine
    expect(cell(rows, "18:30")).toEqual({
      state: "unavailable",
      reason: "no-fit",
    });
    expect(cell(rows, "18:00").state).toBe("available"); // ends exactly when the booking starts
  });

  it("keeps each court's bookings in its own column", () => {
    const rows = grid({
      courts: [court(), court({ id: "c2", name: "Court 2" })],
      busy: [{ facilityId: "c2", startsAt: at("10:00"), endsAt: at("11:00") }],
    });
    expect(cell(rows, "10:00", 0).state).toBe("available");
    expect(cell(rows, "10:00", 1).state).toBe("booked");
  });

  it("respects opening hours and the closing time", () => {
    const rows = grid({
      courts: [court({ openMinute: 9 * 60, closeMinute: 22 * 60 })],
    });
    expect(cell(rows, "08:30")).toEqual({
      state: "unavailable",
      reason: "closed",
    });
    expect(cell(rows, "21:00").state).toBe("available");
    expect(cell(rows, "21:30")).toEqual({
      state: "unavailable",
      reason: "no-fit",
    });
    expect(cell(rows, "22:00")).toEqual({
      state: "unavailable",
      reason: "closed",
    });
  });

  it("refuses slots that start too soon", () => {
    const rows = grid({ now: zonedToUtc(DAY, 12 * 60, MADRID)! });
    expect(cell(rows, "12:00")).toEqual({
      state: "unavailable",
      reason: "past",
    });
    expect(cell(rows, "12:30").state).toBe("available"); // 30 minutes' notice
  });

  it("sends free or near-free courts to the desk", () => {
    expect(cell(grid({ courts: [court({ rate: null })] }), "18:00")).toEqual({
      state: "unavailable",
      reason: "desk",
    });
  });
});

describe("parseGridDuration", () => {
  it("accepts the offered lengths and falls back to an hour", () => {
    expect(parseGridDuration("90")).toBe(90);
    expect(parseGridDuration("45")).toBe(60);
    expect(parseGridDuration(undefined)).toBe(60);
    expect(parseGridDuration("120; DROP TABLE")).toBe(60);
  });
});

describe("moneyLocale", () => {
  it("formats euros the way Portuguese and Spanish players read them", () => {
    const euros = (country: string) =>
      new Intl.NumberFormat(moneyLocale(country), {
        style: "currency",
        currency: "EUR",
      })
        .format(24)
        .replace(/\s/g, " ");
    expect(euros("PT")).toBe("24,00 €");
    expect(euros("es")).toBe("24,00 €");
    expect(moneyLocale("ZZ")).toBe("en-IE");
  });
});
