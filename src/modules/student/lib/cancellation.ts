import { computeRefund, type RefundPolicy, type RefundRule } from "@/modules/billing/lib/refund-policy";

// The student-facing side of cancellation policies: what you'd get back if
// you cancelled now, and until when that holds. Rules come from the club's
// CancellationPolicy; a club without one uses DEFAULT_POLICY.

export const DEFAULT_POLICY: RefundPolicy = {
  organizerCancelRefundPercent: 100,
  rules: [
    { minHoursBeforeStart: 24, refundPercent: 100 },
    { minHoursBeforeStart: 0, refundPercent: 0 },
  ],
};

export type RefundTimeline = {
  /** Refund if cancelled right now. */
  percent: number;
  /** When `percent` stops applying (the next lower tier starts), or null. */
  until: Date | null;
  /** The refund after `until`. */
  nextPercent: number | null;
};

export function refundTimeline(policy: RefundPolicy, startsAt: Date, now: Date = new Date()): RefundTimeline {
  const hours = (startsAt.getTime() - now.getTime()) / 3_600_000;
  const { refundPercent, rule } = computeRefund(policy, 100, Math.max(hours, 0), "PARTICIPANT");
  if (!rule) return { percent: refundPercent, until: null, nextPercent: null };
  // The rule applies while hoursBefore >= its threshold; after that, the next lower rule.
  const lower: RefundRule | undefined = [...policy.rules]
    .filter((r) => r.minHoursBeforeStart < rule.minHoursBeforeStart)
    .sort((a, b) => b.minHoursBeforeStart - a.minHoursBeforeStart)[0];
  // Already in the last tier: nothing changes until the start.
  if (!lower && rule.minHoursBeforeStart === 0) return { percent: refundPercent, until: null, nextPercent: null };
  return { percent: refundPercent, until: new Date(startsAt.getTime() - rule.minHoursBeforeStart * 3_600_000), nextPercent: lower?.refundPercent ?? 0 };
}

/** "1 d 4 h", "3 h 20 min", "12 min". */
export function countdown(to: Date, now: Date = new Date()): string {
  const minutes = Math.max(0, Math.round((to.getTime() - now.getTime()) / 60_000));
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  return `${m} min`;
}

/** Whether a player's level suits a match's range (no range = everyone). */
export function levelFits(level: number | null, min: number | null, max: number | null): boolean {
  if (min === null && max === null) return true;
  if (level === null) return false;
  return (min === null || level >= min) && (max === null || level <= max);
}

/** Each player's share of a court price, rounded up so the court is always covered. */
export function splitShare(courtPrice: number, players: number): number {
  if (!Number.isInteger(courtPrice) || courtPrice < 0 || !Number.isInteger(players) || players < 1) throw new RangeError("Invalid split");
  return Math.ceil(courtPrice / players);
}
