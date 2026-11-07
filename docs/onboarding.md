# Paid onboarding and plan entitlements

Signing up can't be used to skip a paid plan. A role that costs money is
granted only by the Stripe webhook, after Stripe confirms the payment. Every
Server Action that a plan limits or unlocks checks the plan again on the
server.

## The flow

| Step | Route | What happens |
| --- | --- | --- |
| 1. Role and personal details | `/onboarding` | Athlete, Coach or Club owner, plus first name, last name, username (`@handle`) and phone number (`chooseRole`; see [Personal details](#personal-details)). Athlete → `STUDENT`, onboarded, `/dashboard/student`. Coach → `COACH`, onboarded (Free Coach), `/onboarding/plan`. Club owner → **nothing granted**: the account stays a not-onboarded `STUDENT` and goes to `/onboarding/plan?for=club`. |
| 2. Plan | `/onboarding/plan` | Coach: "Continue with Free Coach" (no payment) or "Upgrade to Pro Coach" ($29/mo, Stripe Checkout). Club owner: Club Basic ($99/mo) or Club Enterprise ($299/mo), plus the club's name, address, city, country, time zone and currency, then Stripe Checkout. There is no free club option. |
| 3. Payment | Stripe Checkout → `/onboarding/complete` | The page waits ("Confirming your payment…") until the webhook has provisioned the purchase, then opens the new club's dashboard or `/dashboard/coach?upgraded=1`. A cancelled Checkout returns to step 2 with nothing created. |

Club owners add more clubs the same way from `/dashboard/club?new=1`. A club
whose subscription ended picks a new plan on its Billing page
(`startClubSubscriptionCheckout`). Coaches upgrade from **Booking link &
rates**. Paying subscribers manage their card, invoices and cancellation in
the Stripe billing portal ("Manage billing").

### Why it can't be bypassed

- **The role isn't in any form.** `selfAssignableRoles` is `STUDENT` and
  `COACH` only, and `chooseRole` grants nothing for Club owner.
  `CLUB_OWNER` is set in exactly one place: `provisionFromCheckout`
  (`src/modules/payments/subscriptions.ts`), run by the signed webhook.
- **There is no free way to create a club.** The old `createClub` action is
  gone, and a `Club` row is inserted only by provisioning.
- **The purchase is decided on the server.** Before redirecting to Stripe,
  `startClubCheckout` writes a `PlanCheckout` row. It holds the buyer, the
  plan (checked against `CLUB_BASIC | CLUB_ENTERPRISE`) and the club's
  details, and it reserves the address (`PlanCheckout_open_slug_key`). The
  Checkout Session carries only that row's id. The Price comes from
  `SubscriptionPlan.stripePriceId` and is never taken from the browser.
- **Provisioning trusts Stripe's API, not the event.** On
  `checkout.session.completed` (mode `subscription`), the webhook first
  verifies the signature. It then loads the `PlanCheckout` and
  re-retrieves the subscription from Stripe. It provisions only if all of
  these hold:
  - the Session is the one created for this checkout;
  - it is complete;
  - the subscription is `active` or `trialing`;
  - the subscription is for this plan's Price (so a cheaper Price can't
    unlock a dearer plan);
  - it belongs to the buyer's Stripe customer.

  Otherwise the `PlanCheckout` is marked `FAILED` with the reason, for
  support.
- **Provisioning runs at most once.** Under a row lock on the
  `PlanCheckout`, it moves from `OPEN` to `COMPLETED` exactly once. The
  same event replayed is acknowledged (`StripeWebhookEvent`), and the same
  Session re-sent as a new event finds the checkout already `COMPLETED`.
  `Subscription_one_live_per_club` and `Subscription_one_live_per_user`
  back this up in the database.
- **The role takes effect on the next request.** Sessions are database
  sessions: the session callback reads the role from `User` on each
  request, so there is no JWT to refresh or forge.

## Personal details

Step 1 asks every athlete, coach and club owner for:

| Field | Rules | Stored as |
| --- | --- | --- |
| First name, last name | 1–50 characters each, at least one letter, the plain-text rules (no control, bidi or invisible characters). Pre-filled from the Google/Apple name. | `Profile.firstName`, `Profile.lastName`. `"First Last"` also becomes `Profile.displayName` and `User.name`, which rosters, receipts and emails use. |
| Username | `@handle`: 3–30 lowercase letters, numbers, dots and underscores; unique (*"That username is taken"*). | `Profile.handle` |
| Phone number | A country picker (pre-selected from the browser's language region) plus the number, or an international `+…` number. It is checked against that country's numbering plan with `libphonenumber-js` (`max` metadata), so "12345" or "000 000 000" are refused. | `Profile.phone` in E.164 (`+34612345678`), enforced by the `Profile_phone_e164` constraint |

The rules live in `src/modules/profile/lib/personal.ts` (unit tested), and
`savePersonalDetails` writes them for both onboarding and **Settings →
Personal details** (`/dashboard/settings/profile`, in the account menu and
the athlete's Settings). There, anyone can change these details later. The
sign-in email is shown but can't be changed.

The phone number is private: it never appears on public pages (the coach
booking page or profiles). It is shown as a `tel:` link only to people who
work with that person:
- a coach's **Students** list;
- the club's **Staff** roster;
- the club's **Memberships** pass holders.

Accounts created before these fields existed have empty values. Settings
asks them to fill them in.

## Entitlements (`src/lib/entitlements.ts`)

| Helper | Rule |
| --- | --- |
| `requireActiveSubscription(clubId)` | The club's subscription must be `ACTIVE` or `TRIALING`; otherwise it throws an `EntitlementError` (`NO_SUBSCRIPTION` or `SUBSCRIPTION_INACTIVE`, e.g. *"…is past due: the last payment failed"*). |
| `canCreateFacility(clubId, tx)` | Active subscription, and fewer active facilities than the plan's `maxFacilities` (Club Basic: 5; Enterprise: unlimited). Also used when a facility is reactivated. |
| `canAddStaff(clubId, tx)` / `canAddClubMember(clubId, tx)` | Same, against `maxStaff` / `maxAthletes`. |
| `canAddStudent(coachId, studentId, tx)` | Free Coach: at most 15 active students. A student already among them never counts twice. Pro Coach: unlimited. |
| `hasClubFeature` / `requireClubFeature`, `hasCoachFeature` | Features from `src/config/plans.json` (e.g. `payroll`, `open_matches`, `advanced_analytics` for Enterprise; `booking_link` for Pro Coach). Only an active subscription has any. |

"Active students" means the distinct students in the coach's own private
sessions (not cancelled) that are upcoming or ended in the last 30 days.

Limits are read from `SubscriptionPlan`, so admins can change them; features
come from `plans.json`. The checks that count rows lock the club (or the
coach's `User` row) inside the caller's transaction, so two concurrent
requests can't both take the last place.

### Where they're enforced

| Area | Check |
| --- | --- |
| Every club Server Action | `guardClubWrite` (session → membership → permission → not suspended → `requireActiveSubscription`). A form opened before a payment failed is still refused. |
| Club pages | `requireClubSection` sends every section except Billing to the overview while the subscription is inactive. The overview shows why, and Billing shows the plan's status, "Manage billing" (portal) or "Choose a plan". |
| Facilities, staff, memberships | `canCreateFacility`, `canAddStaff`, `canAddClubMember` inside the insert's transaction |
| Overview heatmap, payroll panel, payout CSV | `advanced_analytics`, `payroll` (Enterprise). On Basic, the panels show an upgrade prompt and the CSV route returns 404. |
| Coach sessions | `createSession`: the club's subscription must be active, and open matches need `open_matches`. Private sessions with a student run `canAddStudent` in the transaction, as do `addParticipant` and self-booking (`bookSlot`). |
| Coach booking link | `saveProfile` needs `booking_link`. `getPublicCoach` hides the page without a live Pro subscription, and `getOpenSlots` drops clubs without a live subscription. |
| Athletes | Court booking (`listBookableFacilities`, `createCourtBookingAction`) needs the club's subscription active. The open-match board and `joinOpenMatch` need an Enterprise club. |

## Subscription lifecycle (webhook)

| Event | Effect |
| --- | --- |
| `checkout.session.completed` / `async_payment_succeeded` (subscription mode) | `provisionFromCheckout`, as above |
| `checkout.session.expired` (subscription mode) | The `PlanCheckout` becomes `EXPIRED`, which frees the reserved address |
| `customer.subscription.created` / `updated` / `deleted` / `paused` / `resumed` | `syncSubscription`: the status, period, `cancelAtPeriodEnd`, `canceledAt`, and the Price, tier and fee (after a plan change in the portal) |

A failed renewal makes the subscription `PAST_DUE`, and the club is locked
(writes refused, sections redirected, courts not bookable). When the card is
fixed it is `ACTIVE` again and everything comes back. Nothing is deleted.

## Setup

1. Set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`.
2. Run `npm run stripe:plans -- --create`, put the printed `STRIPE_PRICE_*`
   lines in `.env`, then run `npm run stripe:plans` to verify them and
   store them on the plans.
3. Subscribe the webhook endpoint to the events listed in `.env.example`,
   including `customer.subscription.*`.
4. Enable the customer portal in Stripe (Settings → Billing → Customer
   portal), with plan switching between the three Prices if you want
   owners to upgrade there.

Without Stripe, athletes and Free Coach still sign up, but club sign-up and
Pro Coach say online payment isn't enabled. There is deliberately no
development bypass. Locally, use test-mode keys, or the mocked flow in the
e2e test.

A `PlanCheckout` left `FAILED` means Stripe took a payment that couldn't be
provisioned: the wrong Price, or a club that already has a live
subscription. The `error` column says why. Refund or fix it in Stripe; the
customer sees "We couldn't finish setting up" on `/onboarding/complete`.

### Demo data and real Stripe keys

The demo seed's subscriptions use made-up Stripe ids (`cus_demo04`,
`sub_demo04`, …) so the dashboards have data. With real test-mode keys,
Stripe doesn't know them: "Manage billing" on a seeded club (e.g.
`owner04@demo.nexport.test`) shows *"Stripe has no record of this club's
billing account"* instead of opening the portal. The same happens after
switching `STRIPE_SECRET_KEY` to another account or from test to live. To
try the portal for real, sign up a new club through Checkout (test card
`4242 4242 4242 4242`), and its subscription and customer will exist in your
account. An athlete's stale customer id is replaced automatically, because
it only holds saved cards.

## Tests

```bash
DATABASE_URL=postgresql://… npm run test:e2e:onboarding
```

The test runs against a local Stripe mock (Checkout in subscription mode,
subscriptions, the portal, and signed webhooks) and checks 42 things:

- Choosing Club owner grants nothing, and the club dashboard stays closed.
- A forged plan value and a taken address are refused.
- The purchase is recorded before Stripe, and cancelling creates nothing.
- A subscription paid at the wrong Price is rejected and flagged `FAILED`.
- A forged webhook is a 400.
- Paying provisions an `ACTIVE` club, an `ACTIVE` subscription, the OWNER
  membership and the `CLUB_OWNER` role.
- The complete page waits for the webhook.
- Replays don't duplicate anything.
- Club Basic's 5-court limit and its Enterprise upsells.
- `PAST_DUE` locks the club, and the portal plus reactivation unlock it.
- A cancelled club is offered a new plan, and a customer missing from Stripe
  gets a clear message.
- Free Coach's 15-student cap allows a returning student and refuses a
  16th; Pro Coach lifts the cap after its own Checkout and webhook.

`tests/db/schema_contract.test.sql` also checks the `PlanCheckout`
constraints (fields required by kind, one open checkout per address, one
provisioning per Session).
