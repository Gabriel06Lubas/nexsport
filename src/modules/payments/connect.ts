import "server-only";

import { and, eq, gt, sql } from "drizzle-orm";
import type Stripe from "stripe";

import { db } from "@/db";
import { paymentTransaction, paymentTransfer, stripeAccount } from "@/db/schema";

import { connectStateOf, DISCONNECTED, reversalDue } from "./lib/connect-status";
import { appUrl } from "./stripe";

// Stripe Connect for clubs and coaches.
//
//   * Onboarding: one connected account per club or coach (StripeAccount,
//     unique per owner), created on first "Connect with Stripe". Stripe hosts
//     the dashboard (Express-style controller), nexport pays the fees and
//     bears losses. Owners go through Stripe's hosted onboarding (Account
//     Links); refresh_url regenerates an expired link, return_url brings them
//     back to the page, which re-reads the account.
//   * Accounts v2 (POST /v2/core/accounts): a merchant configuration
//     (card_payments) and a recipient configuration (stripe_transfers). The
//     account id (acct_…) works unchanged with v1 transfers, destination
//     charges and login links.
//   * State: v2.core.account* thin events, account.updated (Connect webhook)
//     and every page view of an account that isn't fully enabled re-read the
//     account (refreshConnectAccount), so a missed webhook only delays the
//     update to the next visit.
//   * Money: court rentals are destination charges straight to the club
//     (charges_enabled). Seat payments are separate charges and transfers:
//     settle.ts queues the club's and coach's shares as PENDING
//     PaymentTransfers, and sendPendingTransfers() sends them once the
//     account's transfers capability is active. A refund reverses the same
//     fraction of each share (reverseTransfersForRefund).

export type ConnectOwner =
  | { kind: "club"; clubId: string; slug: string; name: string; country: string; email: string }
  | { kind: "coach"; userId: string; name: string | null; country: string; email: string };

const ownerWhere = (owner: ConnectOwner) => (owner.kind === "club" ? eq(stripeAccount.clubId, owner.clubId) : eq(stripeAccount.userId, owner.userId));

export const connectPaths = (owner: ConnectOwner) =>
  owner.kind === "club"
    ? { page: `/dashboard/${owner.slug}/billing`, refresh: `/dashboard/${owner.slug}/billing/connect` }
    : { page: "/dashboard/coach/earnings", refresh: "/dashboard/coach/earnings/connect" };

export async function getConnectAccountFor(owner: ConnectOwner) {
  const [row] = await db.select().from(stripeAccount).where(ownerWhere(owner));
  return row ?? null;
}

/**
 * The owner's connected account: the existing one, or a new one created in
 * Stripe and stored. An account the owner disconnected from nexport in
 * Stripe can't be reconnected, so it's replaced by a new one (same row, so
 * the owner keeps one account; past transfers keep their Stripe ids).
 */
export async function ensureConnectAccount(stripe: Stripe, owner: ConnectOwner) {
  const existing = await getConnectAccountFor(owner);
  if (existing && existing.disabledReason !== DISCONNECTED) return existing;
  const ownerKey = `${owner.kind === "club" ? `club-${owner.clubId}` : `coach-${owner.userId}`}${existing ? `-after-${existing.stripeAccountId}` : ""}`;
  // Same idempotency key on a double click or retry: Stripe returns the same account.
  // Accounts v2: Stripe no longer lets new Connect platforms create v1 accounts.
  const account = await stripe.v2.core.accounts.create(
    {
      display_name: owner.name ?? undefined,
      contact_email: owner.email,
      identity: { country: owner.country.toUpperCase(), ...(owner.kind === "coach" ? { entity_type: "individual" as const } : {}) },
      dashboard: "express",
      defaults: {
        responsibilities: { fees_collector: "application", losses_collector: "application" },
        profile: { product_description: owner.kind === "club" ? "Court rentals, coached sessions and memberships" : "Coaching sessions" },
      },
      configuration: {
        // card_payments: court rentals are destination charges to the club.
        merchant: { capabilities: { card_payments: { requested: true } } },
        // stripe_transfers: the club's and coach's shares of seat payments.
        recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } },
      },
      include: accountIncludes,
      metadata: owner.kind === "club" ? { clubId: owner.clubId } : { userId: owner.userId },
    },
    { idempotencyKey: `connect-account-v2-${ownerKey}` },
  );
  const state = connectStateOf(account);
  const country = (account.identity?.country ?? owner.country).toUpperCase();
  const defaultCurrency = (account.defaults?.currency ?? "eur").toLowerCase();
  if (existing) {
    await db
      .update(stripeAccount)
      .set({ stripeAccountId: account.id, country, defaultCurrency, ...state })
      .where(eq(stripeAccount.id, existing.id));
    return (await getConnectAccountFor(owner))!;
  }
  await db
    .insert(stripeAccount)
    .values({
      ...(owner.kind === "club" ? { clubId: owner.clubId } : { userId: owner.userId }),
      stripeAccountId: account.id,
      type: "EXPRESS",
      country,
      defaultCurrency,
      ...state,
    })
    .onConflictDoNothing();
  return (await getConnectAccountFor(owner))!;
}

/** What every create / retrieve asks Stripe to return (v2 objects are sparse by default). */
const accountIncludes: Stripe.V2.Core.AccountRetrieveParams.Include[] = ["configuration.merchant", "configuration.recipient", "defaults", "identity", "requirements"];

/** Stripe-hosted onboarding (also collects anything Stripe asks for later). */
export async function createOnboardingLink(stripe: Stripe, stripeAccountId: string, owner: ConnectOwner) {
  const paths = connectPaths(owner);
  const link = await stripe.v2.core.accountLinks.create({
    account: stripeAccountId,
    use_case: {
      type: "account_onboarding",
      account_onboarding: { refresh_url: appUrl(paths.refresh), return_url: appUrl(`${paths.page}?connect=return`) },
    },
  });
  return link.url;
}

/**
 * Stripe doesn't know the stored account: 404, or 403 (it belongs to another
 * platform or environment). Typical cause: the secret key was switched, e.g.
 * from test mode to a sandbox, or the row came from the demo seed.
 */
function isUnknownAccount(error: unknown): boolean {
  const status = (error as { statusCode?: number } | null)?.statusCode;
  return status === 404 || status === 403;
}

/**
 * "Connect with Stripe" / "Continue setup": the owner's account (created if
 * needed) and a fresh onboarding link. A stored account the current key
 * can't see is set aside (marked disconnected) and replaced by a new one,
 * instead of failing on every click.
 */
export async function onboardingLinkFor(stripe: Stripe, owner: ConnectOwner) {
  const account = await ensureConnectAccount(stripe, owner);
  try {
    return await createOnboardingLink(stripe, account.stripeAccountId, owner);
  } catch (error) {
    const unknown = await stripe.v2.core.accounts.retrieve(account.stripeAccountId).then(
      () => false,
      (e: unknown) => isUnknownAccount(e),
    );
    if (!unknown) throw error;
    console.warn(`[connect] ${account.stripeAccountId} isn't visible with the current Stripe key; creating a new account`);
    await disconnectConnectAccount(account.stripeAccountId);
    const replacement = await ensureConnectAccount(stripe, { ...owner, country: owner.country || account.country });
    return createOnboardingLink(stripe, replacement.stripeAccountId, owner);
  }
}

/** Stripe refused hosted onboarding because the key is a legacy test-mode key, not a sandbox. */
export function needsSandbox(error: unknown): boolean {
  const message = (error as { message?: string } | null)?.message ?? "";
  return /in testmode/i.test(message) && /sandbox/i.test(message);
}

/** One-time link into the account's Stripe dashboard (payouts, bank details, tax forms). */
export async function createDashboardLink(stripe: Stripe, stripeAccountId: string) {
  return (await stripe.accounts.createLoginLink(stripeAccountId)).url;
}

/**
 * Stores what Stripe says about an account. Returns the account row, or null
 * if it isn't one of ours. When the transfers capability turns on, the
 * caller sends the shares that were waiting for it.
 */
export async function syncConnectAccount(account: Stripe.V2.Core.Account) {
  const [stored] = await db.select({ detailsSubmitted: stripeAccount.detailsSubmitted }).from(stripeAccount).where(eq(stripeAccount.stripeAccountId, account.id));
  if (!stored) return null;
  const state = connectStateOf(account, { submittedBefore: stored.detailsSubmitted });
  const currency = account.defaults?.currency;
  const country = account.identity?.country;
  const [row] = await db
    .update(stripeAccount)
    .set({
      ...state,
      ...(currency ? { defaultCurrency: currency.toLowerCase() } : {}),
      ...(country ? { country: country.toUpperCase() } : {}),
    })
    .where(eq(stripeAccount.stripeAccountId, account.id))
    .returning();
  return row ?? null;
}

/** Re-reads an account from Stripe (pages call this while setup isn't complete). */
export async function refreshConnectAccount(stripe: Stripe, stripeAccountId: string, { throwOnError = false } = {}) {
  try {
    return await syncConnectAccount(await stripe.v2.core.accounts.retrieve(stripeAccountId, { include: accountIncludes }));
  } catch (error) {
    if (throwOnError) throw error;
    // Not visible with this key (switched keys, demo seed): the next "Connect" click replaces it.
    if (isUnknownAccount(error)) return null;
    console.error(`[connect] could not refresh ${stripeAccountId}`, error);
    return null;
  }
}

/**
 * Webhooks: an account changed in Stripe. Only accounts nexport stores, and
 * not disconnected ones (Stripe refuses to read those), are re-read; a failed
 * read throws, so the webhook answers 500 and Stripe retries it.
 */
export async function connectAccountChanged(stripe: Stripe, stripeAccountId: string) {
  const [known] = await db.select({ disabledReason: stripeAccount.disabledReason }).from(stripeAccount).where(eq(stripeAccount.stripeAccountId, stripeAccountId));
  if (!known || known.disabledReason === DISCONNECTED) return null;
  const row = await refreshConnectAccount(stripe, stripeAccountId, { throwOnError: true });
  if (row?.transfersEnabled) await sendPendingTransfers(stripe, { accountId: row.id });
  return row;
}

/** account.application.deauthorized / v2.core.account.closed: the account can't be used here any more. */
export async function disconnectConnectAccount(stripeAccountId: string) {
  await db
    .update(stripeAccount)
    .set({ status: "RESTRICTED", chargesEnabled: false, payoutsEnabled: false, transfersEnabled: false, disabledReason: DISCONNECTED })
    .where(eq(stripeAccount.stripeAccountId, stripeAccountId));
}

/**
 * Sends the queued shares of succeeded seat payments to connected accounts
 * whose transfers capability is active: all of them, or those of one
 * payment / one account. Each transfer is claimed under a row lock (SKIP
 * LOCKED, so concurrent webhooks never send it twice), sent with an
 * idempotency key, and drawn from the original charge (source_transaction),
 * so it never depends on the platform's available balance.
 */
export async function sendPendingTransfers(stripe: Stripe, scope: { paymentId?: string; accountId?: string } = {}) {
  const candidates = await db
    .select({ id: paymentTransfer.id })
    .from(paymentTransfer)
    .innerJoin(stripeAccount, eq(stripeAccount.id, paymentTransfer.stripeAccountId))
    .innerJoin(paymentTransaction, eq(paymentTransaction.id, paymentTransfer.paymentId))
    .where(
      and(
        eq(paymentTransfer.status, "PENDING"),
        gt(paymentTransfer.amount, paymentTransfer.reversedAmount),
        eq(stripeAccount.transfersEnabled, true),
        eq(paymentTransaction.status, "SUCCEEDED"),
        scope.paymentId ? eq(paymentTransfer.paymentId, scope.paymentId) : undefined,
        scope.accountId ? eq(paymentTransfer.stripeAccountId, scope.accountId) : undefined,
      ),
    )
    .limit(100);

  let sent = 0;
  for (const { id } of candidates) {
    const result = await db.transaction(async (tx) => {
      const [t] = await tx
        .select({
          id: paymentTransfer.id,
          amount: paymentTransfer.amount,
          reversedAmount: paymentTransfer.reversedAmount,
          currency: paymentTransfer.currency,
          recipientType: paymentTransfer.recipientType,
          destination: stripeAccount.stripeAccountId,
          paymentId: paymentTransaction.id,
          chargeId: paymentTransaction.stripeChargeId,
          intentId: paymentTransaction.stripePaymentIntentId,
          transferGroup: paymentTransaction.transferGroup,
        })
        .from(paymentTransfer)
        .innerJoin(stripeAccount, eq(stripeAccount.id, paymentTransfer.stripeAccountId))
        .innerJoin(paymentTransaction, eq(paymentTransaction.id, paymentTransfer.paymentId))
        .where(and(eq(paymentTransfer.id, id), eq(paymentTransfer.status, "PENDING")))
        .for("update", { of: paymentTransfer, skipLocked: true });
      if (!t) return false;

      let chargeId = t.chargeId;
      if (!chargeId && t.intentId) {
        // Checkout reports the PaymentIntent, not the charge: look it up once and keep it.
        try {
          const intent = await stripe.paymentIntents.retrieve(t.intentId);
          chargeId = typeof intent.latest_charge === "string" ? intent.latest_charge : (intent.latest_charge?.id ?? null);
        } catch (error) {
          console.error(`[connect] transfer ${t.id} postponed: charge of ${t.intentId} unavailable`, error);
          return false;
        }
        if (chargeId) await tx.update(paymentTransaction).set({ stripeChargeId: chargeId }).where(eq(paymentTransaction.id, t.paymentId));
      }
      try {
        const transfer = await stripe.transfers.create(
          {
            amount: t.amount - t.reversedAmount,
            currency: t.currency,
            destination: t.destination,
            transfer_group: t.transferGroup,
            ...(chargeId ? { source_transaction: chargeId } : {}),
            metadata: { paymentId: t.paymentId, paymentTransferId: t.id, recipientType: t.recipientType },
          },
          { idempotencyKey: `transfer-${t.id}` },
        );
        await tx.update(paymentTransfer).set({ status: "PAID", stripeTransferId: transfer.id, failureMessage: null }).where(eq(paymentTransfer.id, t.id));
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Network trouble, rate limits, Stripe outages: leave it PENDING for the next attempt.
        const type = (error as { type?: string } | null)?.type;
        if (type === "StripeConnectionError" || type === "StripeRateLimitError" || type === "StripeAPIError") {
          console.error(`[connect] transfer ${t.id} postponed: ${message}`);
          return false;
        }
        console.error(`[connect] transfer ${t.id} failed: ${message}`);
        await tx.update(paymentTransfer).set({ status: "FAILED", failureMessage: message.slice(0, 500) }).where(eq(paymentTransfer.id, t.id));
        return false;
      }
    });
    if (result) sent++;
  }
  return sent;
}

/**
 * After a refund of a seat payment: take back the same fraction of the club's
 * and the coach's shares. Shares already sent are reversed in Stripe; shares
 * still queued are reduced (sent net, or not at all). Safe to run again: it
 * only reverses what the refunded total calls for beyond what's reversed.
 */
export async function reverseTransfersForRefund(stripe: Stripe, paymentId: string) {
  const [payment] = await db
    .select({ amount: paymentTransaction.amount, refunded: paymentTransaction.refundedAmount })
    .from(paymentTransaction)
    .where(eq(paymentTransaction.id, paymentId));
  if (!payment || payment.refunded <= 0) return 0;
  const transfers = await db.select().from(paymentTransfer).where(eq(paymentTransfer.paymentId, paymentId));
  let reversed = 0;
  for (const t of transfers) {
    if (t.status === "FAILED" || t.status === "REVERSED") continue;
    const due = reversalDue(t, payment.refunded, payment.amount);
    if (due === 0) continue;
    const total = t.reversedAmount + due;
    if (t.status === "PAID" && t.stripeTransferId) {
      try {
        await stripe.transfers.createReversal(t.stripeTransferId, { amount: due, metadata: { paymentId } }, { idempotencyKey: `reversal-${t.id}-${total}` });
      } catch (error) {
        console.error(`[connect] reversal of ${t.id} failed`, error);
        continue;
      }
    }
    await db
      .update(paymentTransfer)
      .set({ reversedAmount: total, ...(total >= t.amount ? { status: "REVERSED" as const } : {}) })
      .where(and(eq(paymentTransfer.id, t.id), eq(paymentTransfer.reversedAmount, t.reversedAmount)));
    reversed += due;
  }
  return reversed;
}

/** Shares still waiting on an account (shown to the owner while setup isn't complete). */
export async function pendingSharesFor(accountRowId: string) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int`, amount: sql<number>`COALESCE(sum(${paymentTransfer.amount} - ${paymentTransfer.reversedAmount}), 0)::int` })
    .from(paymentTransfer)
    .where(and(eq(paymentTransfer.stripeAccountId, accountRowId), eq(paymentTransfer.status, "PENDING")));
  return row ?? { n: 0, amount: 0 };
}

/**
 * The owner's account for a page view. Until it's fully set up (or right
 * after the owner returns from Stripe), it's re-read from Stripe, so a missed
 * account.updated webhook only delays the update to the next visit; shares
 * that were waiting for the account are sent as soon as it can take them.
 */
export async function loadConnectAccount(stripe: Stripe | null, owner: ConnectOwner, { justReturned = false } = {}) {
  let account = await getConnectAccountFor(owner);
  // A disconnected account can't be read any more; nothing to refresh until a new one is connected.
  if (!stripe || !account || account.disabledReason === DISCONNECTED) return account;
  const incomplete = account.status !== "ACTIVE" || !account.transfersEnabled;
  if (incomplete || justReturned) {
    const fresh = await refreshConnectAccount(stripe, account.stripeAccountId);
    if (fresh) account = fresh;
  }
  // Shares left waiting (the account just became ready, or an earlier send was postponed) go out now.
  if (account.transfersEnabled) await sendPendingTransfers(stripe, { accountId: account.id }).catch((error) => console.error("[connect] sending waiting shares failed", error));
  return account;
}

export type ConnectAccountRow = NonNullable<Awaited<ReturnType<typeof getConnectAccountFor>>>;
