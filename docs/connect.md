# Stripe Connect: club and coach payouts

Clubs and coaches get paid through their own Stripe accounts, connected to
nexport (Stripe Connect). Stripe hosts the onboarding, and the owner manages
the account in the full Stripe dashboard. Risk is Stripe-managed (Stripe
requires it for new platforms): Stripe collects its fees from the account
and covers negative balances. nexport's own fee is taken from every payment.

## What connecting unlocks

| Who | Where | Unlocks |
| --- | --- | --- |
| Club owner | **Billing → Stripe Connect account** | Online court booking: rentals are destination charges straight to the club's account. Also the club's share of online seat payments. |
| Coach | **Earnings → Stripe Connect account** | Their share of online seat payments (group classes, private sessions, open matches). |

A court can be booked online when:
- the club is open to the public (an active or trialing subscription);
- the court is active;
- the club's account can take charges.

Until then, **Facilities** says courts are desk-only and links to Billing.

## The flow

1. **Connect with Stripe.** Clubs: the owner only, never staff and never an
   admin impersonating. Coaches: they pick their country first, because
   Stripe can't change it later. This creates the connected account with
   **Accounts v2** (`POST /v2/core/accounts`; Stripe refuses v1 account
   creation for new Connect platforms):
   - `identity.country`, `contact_email`, `display_name` (coaches:
     `entity_type = individual`);
   - `dashboard = full`; `fees_collector` and `losses_collector` = stripe
     (Stripe answers `account_creation_losses_collector_unavailable` to
     `application`);
   - the **merchant** configuration with `card_payments` (court rentals) and
     the **recipient** configuration with `stripe_balance.stripe_transfers`
     (seat shares).

   It's stored in `StripeAccount` (one per club or coach) and the owner is
   sent to Stripe's hosted onboarding (a v2 Account Link,
   `use_case.type = account_onboarding`). The account id (`acct_…`) works
   unchanged with v1 transfers and destination charges. "Open Stripe
   dashboard" sends the owner to dashboard.stripe.com to sign in (accounts
   stored as `EXPRESS`, from before, still get a one-time login link).
2. **Back from Stripe** (`return_url` = the page with `?connect=return`): the
   page re-reads the account from Stripe and shows what's still needed, in
   words (bank account, identity document, …). The button follows the state:
   *Continue setup in Stripe*, *Update details in Stripe* or *Open Stripe
   dashboard*.
3. **Expired link** (`refresh_url` = `…/billing/connect` or
   `/dashboard/coach/earnings/connect`): a fresh link is issued. These routes
   only serve the account's owner and never create an account.
4. **`account.updated`** (a snapshot event from the Connect endpoint; its
   payload is ignored) makes the app re-read the account through Accounts v2
   and store:
   - charges enabled (merchant `card_payments` active), transfers enabled
     (recipient `stripe_transfers` active), payouts enabled
     (`stripe_balance.payouts` active);
   - details submitted (nothing left waiting on the owner; once on, it stays
     on, so later requirements read as "update details");
   - requirements due (`requirements.entries` awaiting the owner, currently
     or past due);
   - status (`ONBOARDING`, `PENDING_VERIFICATION`, `ACTIVE`, `RESTRICTED`,
     `REJECTED`; `src/modules/payments/lib/connect-status.ts`).

   Until an account is fully set up, every visit to the page also re-reads
   it, so a missed webhook only delays the update.
5. **`account.application.deauthorized`** or **`v2.core.account.closed`**:
   the account can't be used any more. The account stops taking payments here, and the page offers
   *Connect a new Stripe account*, which replaces it. Stripe doesn't let a
   disconnected account be reconnected.

## Seat payments: shares and refunds

Seats are paid on nexport's account (separate charges and transfers). When
the payment succeeds, the webhook settles it:
1. The club's share and the coach's share are recorded as `PENDING`
   `PaymentTransfer` rows. Only accounts that exist at that moment get a row.
2. `sendPendingTransfers` sends every share whose account has the
   `transfers` capability active:
   - each share is claimed under a row lock (`SKIP LOCKED`), so it's never
     sent twice;
   - it's sent with an idempotency key;
   - it's drawn from the original charge (`source_transaction`), so it never
     depends on nexport's available balance.
3. A share waiting for an account that isn't ready is sent when the account
   becomes ready (`account.updated`), or on the owner's next visit to
   Billing or Earnings. The page shows how much is waiting.
4. A network error, rate limit or Stripe outage leaves a share `PENDING`. A
   refusal (for example, an invalid destination) marks it `FAILED`, with
   Stripe's message in `failureMessage`; failed shares show on the admin's
   Financials page.
5. **Refunds** take back the same fraction of each share. A share already
   sent is reversed in Stripe (`transfers.createReversal`); one still waiting
   is reduced. A 50% refund reverses half of the club's and half of the
   coach's share, and a second refund tops it up (`reversalDue`).

Court rentals need none of this: they're destination charges, and refunds
use `reverse_transfer` and `refund_application_fee`.

## Setup

0. **Test in a Stripe sandbox, not legacy test mode.** Stripe refuses
   hosted onboarding of Accounts v2 accounts with card payments under
   test-mode keys ("Cannot create a v2 account link … in testmode. Please
   switch to an account created in a sandbox"). Create one from the account
   picker (top left) → Sandboxes, and use its `sk_test_…` / `pk_test_…`
   keys, its webhook secrets, and its Prices (`STRIPE_PRICE_*`): ids from
   test mode don't exist in a sandbox. A stored connected account the
   current key can't see is replaced by a new one on the next "Connect"
   click; customers are re-created the same way.
1. Turn on Connect in the Stripe dashboard (Settings → Connect).
2. Add a **Connect** webhook endpoint (`<AUTH_URL>/api/webhooks/stripe`,
   "Events on connected accounts", snapshot payloads) with
   `account.updated` and `account.application.deauthorized`. Put its secret
   in `STRIPE_CONNECT_WEBHOOK_SECRET`. The route accepts it or the platform
   endpoint's secret, and pages re-read unfinished accounts on every visit,
   so a missed event only delays an update.
3. Locally, one listener covers both (it forwards connected accounts' events
   too, signed with the same secret):
   ```bash
   stripe listen --forward-to localhost:3000/api/webhooks/stripe
   ```
   Put the printed `whsec_…` in `STRIPE_WEBHOOK_SECRET`.

Thin event notifications (`v2.core.account*`) aren't used: the webhook
answers them with 400. `account.updated` carries the same news, and the app
re-reads the account from Stripe anyway, which is what thin events are for.

### When account.updated seems to do nothing

The dev server logs what it did with each `account.updated`:

- `… is now ACTIVE` (or another status): the account was re-read and stored.
- `isn't a connected account nexport stores`: the event names an account
  nexport didn't create, as `stripe trigger account.updated` and Dashboard
  test events do. Only accounts created through "Connect with Stripe" are
  updated, so test with a real sandbox onboarding: connect a club, finish
  (or leave and resume) Stripe's onboarding, and watch Billing.
- `event refused: no configured signing secret matches` (the CLI shows
  400): the listener's `whsec_…` isn't in `.env`, or the dev server wasn't
  restarted after setting it.

## Limits

- **Shares earned before connecting.** A coach or club without an account
  when a seat is paid has no transfer row, so that share stays with nexport.
  Connecting later doesn't backfill it; it would need an admin decision.
- **Disputes** (`charge.dispute.*`) are logged but not acted on. Stripe
  covers losses the connected account can't pay back
  (`losses_collector = stripe`); for destination charges (court rentals)
  disputes still debit the platform first, as with any destination charge.
- **The demo seed's accounts** (`acct_demo…`) don't exist in a real Stripe
  account. With real keys, their queued shares fail as soon as a page tries
  to send them.

## Tests

```bash
DATABASE_URL=postgresql://… npm run test:e2e:connect
```

The test runs against a local Stripe mock (v2 accounts and account links,
which refuses v1 account creation like Stripe; transfers,
reversals, refunds; snapshot webhooks signed with each secret) and checks
33 things:
- desk-only until connected;
- the account's parameters;
- leaving and resuming onboarding, an expired link, a stranger's 404;
- `account.updated` from the Connect endpoint turning online booking on, and
  one signed with the platform secret (a single local listener) doing the
  same for a coach;
- the dashboard link going to the full Stripe dashboard;
- the coach's country;
- a seat's club share sent at once and the coach's share once they finish
  (exactly once, from the charge);
- a 50% refund reversing half of each share;
- deauthorization turning booking off, and connecting a new account;
- the sandbox message for a test-mode refusal, and an account the key can't
  see replaced on the next click;
- thin event notifications refused, and a forged webhook refused.

The student e2e also checks that both shares of a paid seat are sent.
`src/modules/payments/lib/connect-status.test.ts` covers the state mapping
and the reversal arithmetic.
