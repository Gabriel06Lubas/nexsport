# Admin dashboard

Admins (`User.role = 'ADMIN'`) run the whole SaaS from `/admin`. There is no
way to become an admin from the app: the role is only ever set directly in the
database.

| Route | What it shows |
| --- | --- |
| `/admin` | KPI cards (MRR, active tenants, Stripe Connect health, volume), recent activity, tenant and webhook summary |
| `/admin/tenants` | Searchable, paginated table of every club and independent coach, with an actions menu per row |
| `/admin/tenants/club/:id`, `/admin/tenants/coach/:id` | Tenant detail: owner, plan, Connect account, usage, recent payments, admin history |
| `/admin/subscriptions` | Plan manager for `FREE_COACH`, `PRO_COACH`, `CLUB_BASIC`, `CLUB_ENTERPRISE` |
| `/admin/financials` | Platform-fee queue, disputes, failed transfers, Connect accounts needing attention, latest webhooks |
| `/admin/logs` | Stripe webhook events (search, failed/unprocessed filters) and the admin audit log |

The layout is a sidebar on large screens and a collapsible menu on phones;
wide tables scroll inside their panel.

## Creating an admin

1. Insert the row (local database example; use your own email):

   ```sql
   INSERT INTO "User" (id, email, name, role, "emailVerified", "onboardedAt", "updatedAt")
   VALUES ('admin0001', 'you@example.com', 'Your Name', 'ADMIN', now(), now(), now());
   ```

   or promote an existing account:
   `UPDATE "User" SET role = 'ADMIN' WHERE email = 'you@example.com';`

2. Sign in at `/login` with that address ("Continue with email", or Google /
   Apple with the same verified email). Admins land on `/admin` and skip
   onboarding.

Removing the role (`UPDATE "User" SET role = 'STUDENT' …`) takes effect on the
admin's next request, and also ends any impersonation they are running.

## Demo data

```bash
npm run db:seed
```

Fills a **local** database with 6 clubs, 5 independent coaches, 6 athletes,
subscriptions, Connect accounts (healthy, restricted, onboarding), 24 paid
bookings with platform fees, refunds, disputes, failed transfers and webhook
events. It refuses to run in production or against a non-local host, only
touches its own rows (`@demo.nexport.test` emails, `demo…` ids), replaces
them on every run, and never creates an admin.

## KPI definitions

| KPI | Definition |
| --- | --- |
| Platform MRR | Sum of `Subscription.monthlyAmount` for `ACTIVE` and `PAST_DUE` subscriptions (trials aren't paying yet). `monthlyAmount` is a snapshot of what each customer pays, so editing a plan's list price never changes existing MRR. Shown per currency. |
| Active tenants | Clubs with status `ACTIVE` plus coaches (`role = COACH`) who aren't suspended. "Pro" counts coaches with a live `PRO_COACH` subscription. |
| Stripe Connect health | Share of `StripeAccount` rows with both `chargesEnabled` and `payoutsEnabled`. |
| Total volume processed | Sum of `PaymentTransaction.amount` with status `SUCCEEDED` (before refunds), with the last 30 days and platform fees underneath. |

A **tenant** is a club or an independent coach. Coaches without a paid plan
are on `FREE_COACH`.

## Security model

- **Access:** `requireAdmin()` (`src/modules/auth/dal.ts`) runs in the admin
  layout, in every admin page, and at the start of every admin action. Anyone
  who isn't an admin gets a plain 404, so the area doesn't reveal that it
  exists. The layout check matters: a 404 thrown by a page renders inside its
  layout, so without it a non-admin would see the admin sidebar.
- **Input:** search, filter and page parameters are parsed and clamped
  (`lib/params.ts`). Search text only ever becomes a bound `ILIKE` parameter,
  with `%` and `_` escaped so they match literally. Tenant ids must match
  `^[a-z0-9]{1,64}$` or the page 404s. Plan forms parse money and percentages
  exactly into integer cents and basis points (no floating point), and only
  accept `price_…` Stripe IDs. No SQL is built from strings.
- **Audit:** every plan edit (with before/after values), suspension,
  reactivation and impersonation start/end is written to `AdminAuditLog` in
  the same transaction as the change. Suspending, reactivating and
  impersonating all require a written reason.
- **Concurrent plan edits:** each save checks the plan's `updatedAt` from when
  the form loaded, so one admin can't silently overwrite another's change.

### Suspension

- **Club:** status becomes `SUSPENDED`. Its members keep their accounts.
  (Enforcing the suspension inside club features belongs to the club
  dashboard work.)
- **Coach:** `User.suspendedAt` is set and every session is deleted at once.
  Google/Apple sign-in is refused (`/login?error=Suspended`), and email-code
  sign-in is refused too. Reactivating clears it.

### Impersonation

"Impersonate" lets an admin see nexport as a coach, or as a club's owner, for
support:

- It creates a **separate session** for the target, marked with
  `Session.impersonatorId`, with a **hard 1-hour expiry that never slides**.
  The admin's own session token is parked in an httpOnly cookie.
- The adapter re-checks the impersonating admin on **every request**. If they
  are suspended, deleted or no longer `ADMIN`, the session dies immediately.
- Admins can't be impersonated, and suspended accounts can't either.
- A banner on every page shows who is impersonating whom and when it ends.
- **While impersonating**, `/admin` returns 404, and account-security
  operations are blocked on the server: linking or unlinking sign-in methods,
  revoking sessions, onboarding, and email codes. The security page is hidden.
- "Stop impersonating" deletes the impersonation session and restores the
  admin's own session, after verifying it is still a live session of the same
  admin. Start and end are both audited against the same tenant.

## Plans

Plans live in `SubscriptionPlan` (seeded by migration `0004`; prices are
placeholders). Paid plans start **inactive**: a paid plan can't be active
without a Stripe Price ID, which the app and a database CHECK both enforce,
because it couldn't be sold. Stripe Prices can't be edited, so to change what
new customers pay you create a new Price in Stripe and paste its ID together
with the new amount. Limits left blank mean unlimited.

## Tests

```bash
DATABASE_URL=postgresql://… npm run test:e2e:admin
```

Seeds the demo data, inserts an admin the documented way, signs in with an
email code, and checks 55 things in a real browser:
- non-admins get a plain 404 on every admin route;
- the KPI values;
- search, filters and pagination, including `%` and SQL payloads in URL
  parameters, and bad tenant URLs;
- suspension: sessions revoked and sign-in refused;
- plan validation, saving, auditing and concurrent edits;
- financials and logs;
- the full impersonation lifecycle, including demoting the admin mid-session;
- no horizontal scroll at 375px;
- no browser console errors.

Unit tests cover the parsers and status logic
(`src/modules/admin/lib/admin-lib.test.ts`).

## Not wired up yet

- **Stripe sync.** Subscriptions, Connect accounts, payments and webhook
  events are read from the database. The Stripe webhook handler that keeps
  them in sync is part of Step 4. Saving a plan does not call Stripe.
- **The public pricing page** (`src/config/pricing.ts`) still has its own copy
  of the plans; it could read `SubscriptionPlan` instead.
- **Club suspension inside club features**, and limits enforcement
  (`maxFacilities`, …) when clubs add resources.
