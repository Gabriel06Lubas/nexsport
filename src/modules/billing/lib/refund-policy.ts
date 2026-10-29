// Automated refunds for session cancellations. Mirrors CancellationPolicy /
// CancellationPolicyRule: rules are checked from the largest notice period
// down, the first one met wins, and no match means no refund.

export type RefundRule = { minHoursBeforeStart: number; refundPercent: number };

export type RefundPolicy = {
  rules: readonly RefundRule[];
  /** Applied when the club or coach cancels, regardless of timing. */
  organizerCancelRefundPercent: number;
};

export type RefundDecision = { refundPercent: number; refundAmount: number; rule: RefundRule | null };

export function computeRefund(
  policy: RefundPolicy,
  amount: number,
  hoursBeforeStart: number,
  cancelledBy: "PARTICIPANT" | "ORGANIZER",
): RefundDecision {
  if (cancelledBy === "ORGANIZER") {
    const pct = policy.organizerCancelRefundPercent;
    return { refundPercent: pct, refundAmount: Math.round((amount * pct) / 100), rule: null };
  }
  const rule =
    [...policy.rules]
      .sort((a, b) => b.minHoursBeforeStart - a.minHoursBeforeStart)
      .find((r) => hoursBeforeStart >= r.minHoursBeforeStart) ?? null;
  const pct = rule?.refundPercent ?? 0;
  return { refundPercent: pct, refundAmount: Math.round((amount * pct) / 100), rule };
}
