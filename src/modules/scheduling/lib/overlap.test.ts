import { describe, expect, it } from "vitest";

import { availableUnits, findFacilityConflicts, overlaps } from "./overlap";

const at = (h: number, m = 0) => new Date(Date.UTC(2030, 0, 1, h, m));

describe("overlaps", () => {
  it("treats ranges as half-open", () => {
    expect(overlaps({ startsAt: at(10), endsAt: at(11) }, { startsAt: at(11), endsAt: at(12) })).toBe(false);
    expect(overlaps({ startsAt: at(10), endsAt: at(11) }, { startsAt: at(10, 59), endsAt: at(12) })).toBe(true);
  });
});

describe("findFacilityConflicts", () => {
  const sessions = [
    { id: "a", facilityId: "c1", status: "SCHEDULED" as const, startsAt: at(10), endsAt: at(11) },
    { id: "b", facilityId: "c1", status: "CANCELLED" as const, startsAt: at(12), endsAt: at(13) },
    { id: "c", facilityId: "c2", status: "SCHEDULED" as const, startsAt: at(10), endsAt: at(11) },
  ];

  it("only reports live sessions on the same facility", () => {
    expect(findFacilityConflicts(sessions, { facilityId: "c1", startsAt: at(10, 30), endsAt: at(12, 30) }).map((s) => s.id)).toEqual(["a"]);
  });

  it("ignores the session being rescheduled", () => {
    expect(findFacilityConflicts(sessions, { id: "a", facilityId: "c1", startsAt: at(10), endsAt: at(11) })).toEqual([]);
  });
});

describe("availableUnits", () => {
  it("subtracts overlapping active reservations from stock", () => {
    const res = [
      { equipmentId: "balls", quantity: 6, status: "RESERVED" as const, startsAt: at(10), endsAt: at(11) },
      { equipmentId: "balls", quantity: 3, status: "RETURNED" as const, startsAt: at(10), endsAt: at(11) },
      { equipmentId: "balls", quantity: 2, status: "RESERVED" as const, startsAt: at(11), endsAt: at(12) },
    ];
    expect(availableUnits(10, res, "balls", { startsAt: at(10, 30), endsAt: at(11) })).toBe(4);
    expect(availableUnits(10, res, "balls", { startsAt: at(10, 30), endsAt: at(11, 30) })).toBe(2);
  });
});
