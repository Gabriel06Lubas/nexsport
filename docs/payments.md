# Payments (Stripe)

nexport charges customers with Stripe and pays clubs and coaches through
Stripe Connect. Two flows are live:

| What | How the money moves | Started by |
| --- | --- | --- |
| **Court booking** | PaymentIntent, **destination charge**: paid to the club's connected account (`transfer_data.destination`, `on_behalf_of`), with nexport's fee as `application_fee_amount` | `createCourtBookingAction` (student → *Book a court*) |
| **Open-match seat** | Checkout Session, **separate charges and transfers**: the platform charges, then transfers the club's and the coach's shares (`transfer_group`) | `joinOpenMatch` (student → *Open match finder*) |

Seats need separate charges because one payment is split between a club and
a coach. A court has one recipient, so a destination charge is simpler:
Stripe moves the club's part itself, and a refund can reverse it.

## Setup

1. Put test-mode keys in `.env`: `STRIPE_SECRET_KEY`,
   `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`.
2. Locally, run `stripe listen --forward-to localhost:3000/api/webhooks/stripe`
   and copy the `whsec_…` it prints into `STRIPE_WEBHOOK_SECRET`.
3. In production, add the endpoint `<AUTH_URL>/api/webhooks/stripe` in the
   Stripe dashboard with the six events listed in `.env.example`.
4. A club takes online bookings once its `StripeAccount` has
   `chargesEnabled` and `payoutsEnabled`. Creating Connect accounts and
   onboarding links isn't built yet; see "Not built yet".

Without keys everything still works, and customers pay at the club.

## A. `createCourtBookingAction` (`src/modules/billing/actions/booking-actions.ts`)

1. **Who:** `requireStudent()`. The Auth.js database session is read by the
   DAL; the role must be STUDENT.
2. **What:** zod parses the request: a facility id; date and times on a
   15-minute grid; 30 minutes to 4 hours. `checkWindow()` then checks the
   facility's opening hours, at least 30 minutes' notice, at most 30 days
   ahead, and daylight-saving gaps. The **price is computed on the server**
   from the facility's dynamic pricing, never taken from the client. The fee
   is the club plan's rate (`platformFeeBpsFor`: 3% on Club Enterprise).
3. **Hold, in one transaction:**
   - Re-check the slot against court rentals and coached sessions.
   - Insert a `FacilityBooking` with status **`PENDING`** and a
     `PaymentTransaction` with status `REQUIRES_PAYMENT_METHOD`, held for
     15 minutes.
   - The database has the last word. `FacilityBooking_no_overlap` and the
     rental-vs-session trigger refuse an overlap even when two customers
     submit the same slot in the same instant, and a `PENDING` row blocks
     the slot exactly like a confirmed one.
   - A customer can hold at most 2 unpaid courts at a time.
4. **Charge, after commit:**
   - `paymentIntents.create` runs outside the transaction, so no row locks
     are held during a network call.
   - Idempotency key `pi-<paymentId>`: a retried request returns the same
     PaymentIntent and never charges twice.
   - `metadata.paymentId` ties every later webhook to its row.
   - If Stripe fails, the hold is released at once.
5. Returns the PaymentIntent's **`client_secret`**. The page mounts Stripe's
   Payment Element and calls `confirmPayment`, so card data never touches
   nexport.

Why not `PracticeSession` with a `PENDING` state, as first asked:
- A court rental has no coach or sport, and `PracticeSession` requires both.
- Rentals live in `FacilityBooking`, which the club's schedule, utilisation
  and revenue already read.
- The atomic step is Drizzle's `db.transaction` (the project moved from
  Prisma to Drizzle).

## B. Webhook (`src/app/api/webhooks/stripe/route.ts`)

- **Signature:** `stripe.webhooks.constructEvent(rawBody, Stripe-Signature,
  STRIPE_WEBHOOK_SECRET)` on `await request.text()`, never on re-serialised
  JSON. Anything else gets a 400. The default 5-minute tolerance rejects
  replays of old signed payloads.
- **Once only:** the event id is stored in `StripeWebhookEvent`, which feeds
  the admin's webhook log. An event already processed is acknowledged and
  skipped.
- **Retries:** if handling fails, the error is stored and the route returns
  500, so Stripe retries.
- **Idempotent handlers:** every `UPDATE` is conditional on the state it moves
  from. That also covers one outcome arriving through two events (a Checkout
  seat raises both `checkout.session.completed` and
  `payment_intent.succeeded`).

| Event | Effect (`src/modules/payments/settle.ts`) |
| --- | --- |
| `payment_intent.succeeded` | Payment `SUCCEEDED` (charge id, paid at). Court: booking `PENDING → CONFIRMED`; the club's part (amount − fee) is recorded as a `PAID` transfer. Seat: club and coach transfers are queued `PENDING`. |
| `checkout.session.completed` / `async_payment_succeeded` | Same, for Checkout seats |
| `payment_intent.payment_failed` | Decline code and message are recorded, and the hold is **kept**. A failed PaymentIntent returns to `requires_payment_method` and can be retried with another card. If the hold then expires, the payment ends **`FAILED`** and the slot is released. |
| `payment_intent.canceled` / `checkout.session.expired` | Payment `CANCELED`, slot or seat released |
| Paid **after** its hold was released | The payment is recorded and refunded in full. For a court, the refund uses `reverse_transfer` and `refund_application_fee`. |

Releasing a hold on a declined card immediately would stop the customer
retrying with another card, so a decline is recorded and the release waits
for the hold to expire.

**Expired holds** are swept by `releaseExpiredHolds()`. It runs before any
availability is computed: the booking action, the open-match board, the
club's schedule and the student's pages. So a slot never stays blocked
because Stripe's event was late or lost.

**Refunds** (student cancels) follow the club's cancellation policy. The
cancellation is committed first, then the Stripe refund is sent; a Stripe
failure leaves a visible `PENDING` refund. Court refunds reverse the club's
transfer and nexport's fee in proportion.

## C. Indexes, relations and race-freedom

`npm run db:test` runs `tests/db/schema_contract.test.sql`, which fails if any
of these is missing. It also checks with `EXPLAIN` that the hot queries use
an index.

| Need | Database object |
| --- | --- |
| No double-booking of a court, atomically, at any isolation level | `FacilityBooking_no_overlap` and `PracticeSession_facility_no_overlap`: GiST exclusion on `("facilityId", tstzrange("startsAt","endsAt"))`, skipping cancelled rows only (btree_gist) |
| No rental over a coached session and vice versa | `FacilityBooking_session_overlap_guard` / `PracticeSession_rental_overlap_guard` triggers, which lock the facility row; race-tested in `booking_races.sh` |
| A coach in one place at a time | `PracticeSession_coach_no_overlap` |
| Range lookups by court and time | `FacilityBooking_facilityId_startsAt_idx`, `PracticeSession_facilityId_startsAt_idx` |
| A booking's court belongs to its club | composite FK `(facilityId, clubId) → Facility(id, clubId)` |
| Connect account by club or coach in one probe; one account each | `StripeAccount_clubId_key`, `StripeAccount_userId_key` (unique), `StripeAccount_stripeAccountId_key`, CHECK exactly one owner |
| Webhook → payment row | unique `PaymentTransaction_stripePaymentIntentId_key`, `PaymentTransaction_stripeCheckoutSessionId_key` |
| No double charge | unique `idempotencyKey`; one live payment per booking / seat (partial unique indexes) |
| Transfers recorded once | unique `(paymentId, recipientType)` |
| Expired-hold sweep | `PaymentTransaction_status_idx` (open holds are a tiny slice of payments) |

Column names here are `startsAt` / `endsAt`, not `startTime` / `endTime`.
I first added a partial index for the sweeper, then found the planner uses
the existing status index just as well, so I removed it rather than slow
every write.

## Tests

`npm run test:e2e:student` runs the real flows in a browser against a local
Stripe mock. It stands in for the API and Stripe.js, and sends correctly
signed webhooks. The court-booking checks cover:
- only clubs able to take charges are listed;
- the PaymentIntent's amount, fee, destination, `on_behalf_of`, idempotency
  key and metadata;
- a declined card and its retry;
- confirmation by webhook, with the club's transfer recorded;
- an overlap refused;
- two customers racing for one slot;
- releasing a hold, which cancels the PaymentIntent;
- an expired hold, then a late payment refunded with the transfer and fee
  reversed;
- resuming payment later;
- cancelling with a policy refund.

Seat payments, forged and replayed webhooks are covered too. Unit tests:
`src/modules/billing/lib/court-booking.test.ts`.

## Not built yet

- **Connect onboarding:** creating Express accounts, account links, and
  `account.updated` syncing `chargesEnabled` / `payoutsEnabled`. Accounts are
  seeded for now.
- **Executing seat transfers:** `transfers.create` for queued `PENDING`
  transfers, and refund reversals for seats.
- **Disputes:** `charge.dispute.*` are logged but not acted on.
- **Online payment elsewhere:** passes, self-booked coaching sessions and the
  clubs' SaaS subscriptions are still paid at the club or not yet billed.
