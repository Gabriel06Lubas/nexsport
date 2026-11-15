// How the Stripe webhook route tells the two payload styles apart, and what a
// thin event notification asks nexport to do. Pure, so it's unit tested.

/**
 * A thin event notification (event destinations with the Thin payload style,
 * `stripe listen --all-thin`), as opposed to a snapshot event
 * (`object: "event"`, with `data.object`). Notifications are marked
 * `object: "v2.core.event"`, but the SDK accepts them without it too, so
 * anything that isn't a snapshot event and carries no `data` counts as thin.
 */
export function isThinPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as { object?: unknown; data?: unknown };
  if (p.object === "v2.core.event") return true;
  if (p.object === "event") return false;
  return p.data === undefined;
}

export type ThinAction =
  | { kind: "account-changed"; accountId: string }
  | { kind: "account-closed"; accountId: string }
  | { kind: "ignore"; reason: string };

/** What a thin notification means for nexport (only connected-account events matter). */
export function thinActionFor(n: { type: string; related_object?: { id?: string | null; type?: string | null } | null }): ThinAction {
  const accountId = n.related_object?.id ?? null;
  const isAccountEvent =
    (n.type.startsWith("v2.core.account.") || n.type.startsWith("v2.core.account[")) ||
    // The v1 account.updated, delivered as a thin notification.
    n.type === "v1.account.updated";
  if (!isAccountEvent) return { kind: "ignore", reason: "not a connected-account event (the snapshot endpoint handles the rest)" };
  if (!accountId || !accountId.startsWith("acct_")) return { kind: "ignore", reason: "no account id in related_object" };
  if (n.type === "v2.core.account.closed") return { kind: "account-closed", accountId };
  return { kind: "account-changed", accountId };
}
