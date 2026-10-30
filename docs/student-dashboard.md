# Student dashboard

Students (`User.role = 'STUDENT'`) manage their sport at `/dashboard/student`.
The old `/dashboard/athlete` link redirects there.

| Route | Section |
| --- | --- |
| `/dashboard/student` | **Overview & upcoming**: session passes, upcoming count, memberships; the next 30 days with Confirmed / Pending / Cancelled, Cancel, Pay now and Get directions |
| `/dashboard/student/bookings` | **Bookings & passes**: upcoming (with refund countdowns), past and cancelled bookings; the clubs' cancellation rules; passes, purchases, expiry and credit history |
| `/dashboard/student/open-matches` | **Open match finder**: level-matched open matches with filled slots; join and pay your share through Stripe Checkout |
| `/dashboard/student/settings` | **Account & payments**: saved cards and the Stripe customer portal, billing history, playing level per sport, preferred clubs, notification switches |

On phones the sections are a tab bar at the bottom; on large screens, a sidebar.

## Try it

```bash
npm run db:seed && npm run dev
```

Sign in as `athlete01@demo.nexport.test` (level 3.5 padel, a monthly membership,
court rentals and private lessons) or `athlete02@demo.nexport.test` (a 10-session
punch card with 6 left). To try paying, set test-mode Stripe keys (see
`.env.example`) and run `stripe listen --forward-to localhost:3000/api/stripe/webhook`.

## Access

- The proxy sends visitors without a session cookie to `/login`. It can't read
  the role, because sessions are stored in the database.
- `requireStudent()` (`src/modules/student/dal.ts`) runs in the layout, every
  page and every action. Coaches, club owners and admins are sent to their
  own home.
- Students act only on their own rows: a booking is looked up by id *and*
  student, and every update repeats that condition.

## Cancellations and refunds

- The rules come from the session's cancellation policy, else the club's
  default policy, else nexport's default (full refund up to 24 hours before,
  nothing after). Clubs keep them in `CancellationPolicy` /
  `CancellationPolicyRule`.
- Every upcoming booking shows what cancelling now returns and for how long:
  "Cancel now: 100% back (€48.00) for 1 d 4 h more, then 50%". The Bookings
  page lists each club's rules.
- Cancelling commits first (seat or rental cancelled; the payment records the
  percentage and policy applied), then the refund is sent to Stripe with an
  idempotency key. If Stripe fails, the refund stays `PENDING`, visible to
  the student and the club, instead of being lost.
- A private session the student booked themselves is cancelled entirely,
  freeing the coach and the court. Desk payments are refunded at the desk;
  the message says how much.

## Open matches and split payments

- Coaches post open matches (`kind = OPEN_MATCH`) with an optional level
  range (0.0–10.0) and a player count. With no price set, each player's
  share is the court's price for that slot (dynamic pricing) divided by the
  players, rounded up.
- The board shows upcoming matches with free seats at the student's level by
  default ("all levels" shows the rest, marked *Not your level*). Students
  set their level per sport in Settings. Joining is refused outside the range
  on the server too.
- **Joining a paid match** with Stripe configured:
  1. The seat is taken in the database first; the seat guard refuses a full
     match, even when two players click at once.
  2. A `PaymentTransaction` (`REQUIRES_PAYMENT_METHOD`) holds the seat for
     35 minutes.
  3. The student pays their share in Stripe Checkout. The Checkout Session
     expires at the same moment as the hold.
  4. `POST /api/stripe/webhook` (signature checked, each event processed once)
     marks the payment `SUCCEEDED`, and queues transfers to the club and the
     coach (their Connect accounts) for the split.
  5. If checkout expires, is abandoned and released, or the expiry webhook is
     lost, the seat is freed. A payment that completes *after* the seat was
     freed is refunded in full automatically.
- Without Stripe the student joins and pays their share at the club.

## Match alerts

When a coach posts an open match, students who have match alerts on, have
the club as a preferred club, and whose level fits get an email. Alerts are
sent after the coach's response (`after()`), so posting is never slowed or
blocked by email.

## Stripe

`src/modules/payments/`:
- `stripe.ts`: the client (off without `STRIPE_SECRET_KEY`), customers,
  Checkout for seats, refunds, saved cards and the billing portal. Every call
  that moves money has an idempotency key. Return URLs are built from
  `AUTH_URL`, never from the request's Host header.
- `settle.ts`: what the webhook does to our rows. Every update is conditional
  on the state it moves from, so retries are harmless.
- `/api/stripe/webhook`: verifies `Stripe-Signature` with
  `STRIPE_WEBHOOK_SECRET`, records the event in `StripeWebhookEvent` (the
  admin's log), skips events already processed, and returns 500 on failure
  so Stripe retries.

Card numbers never touch nexport: Checkout and the portal are hosted by Stripe.

## Tests

```bash
DATABASE_URL=postgresql://… npm run test:e2e:student
```

48 checks in a real browser, against a local mock of the Stripe API that also
serves a checkout page and sends signed webhooks:
- access and KPIs;
- Get directions;
- refund previews and countdowns, and cancelling at 100%, 50% and unpaid
  (refund amounts checked at "Stripe");
- policies, past bookings and passes;
- level-matched board;
- paying for a seat (webhook settlement and transfer split);
- an abandoned checkout (held, released, Stripe session expired) and a
  payment after release (auto-refund);
- an expired hold without a webhook;
- two players racing for the last seat;
- the level gate;
- forged and replayed webhooks;
- saved cards, the customer portal, level validation and alert preferences;
- match alerts reaching exactly the right players;
- 375px layout with the tab bar, and no console errors.

Unit tests: refund timelines, countdowns, level matching, split shares and
the forms (`src/modules/student/lib/student-lib.test.ts`).

## Not wired up yet

- **Stripe Connect payouts:** transfers are queued (`PENDING`) when a seat is
  paid. Executing them with Stripe's Transfers API, and Connect onboarding,
  are still to do.
- **Other online payments:** court rentals and passes are bought at the desk;
  self-booked private lessons are paid at the club.
- **Booking-update emails:** the switch is stored; the emails aren't sent yet.
- **Students posting matches:** open matches are posted by coaches.
