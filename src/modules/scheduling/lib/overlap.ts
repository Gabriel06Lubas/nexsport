// Pure booking math shared by the scheduling service and the marketing demos.
// Mirrors the database guards in
// drizzle/0001_booking_guards.sql: ranges are
// half-open [start, end), so back-to-back bookings never conflict.

export type TimeRange = { startsAt: Date; endsAt: Date };

export function overlaps(a: TimeRange, b: TimeRange): boolean {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}

export type FacilityBooking = TimeRange & {
  id: string;
  facilityId: string;
  status: "DRAFT" | "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
};

/** Non-cancelled bookings on the same facility that overlap `candidate`. */
export function findFacilityConflicts<T extends FacilityBooking>(
  existing: readonly T[],
  candidate: TimeRange & { facilityId: string; id?: string },
): T[] {
  return existing.filter(
    (b) =>
      b.facilityId === candidate.facilityId &&
      b.status !== "CANCELLED" &&
      b.id !== candidate.id &&
      overlaps(b, candidate),
  );
}

export type EquipmentReservation = TimeRange & {
  equipmentId: string;
  quantity: number;
  status: "RESERVED" | "CHECKED_OUT" | "RETURNED" | "CANCELLED";
};

/** Units of an item still free during `window`, given its total stock. */
export function availableUnits(
  stock: number,
  reservations: readonly EquipmentReservation[],
  equipmentId: string,
  window: TimeRange,
): number {
  const reserved = reservations
    .filter(
      (r) =>
        r.equipmentId === equipmentId &&
        (r.status === "RESERVED" || r.status === "CHECKED_OUT") &&
        overlaps(r, window),
    )
    .reduce((sum, r) => sum + r.quantity, 0);
  return Math.max(stock - reserved, 0);
}
