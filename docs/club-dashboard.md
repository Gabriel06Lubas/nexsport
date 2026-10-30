# Club dashboard

The club owner / facility manager dashboard lives at `/dashboard/<clubSlug>`.
It is tenant-scoped: everything on it belongs to one club, and access comes
from that club's roster, not from the platform role alone.

| Route | Section | Who can open it |
| --- | --- | --- |
| `/dashboard/club` | Club picker; create a club | Club owners and staff (one club → straight to it) |
| `/dashboard/:slug` | **Overview & analytics**: utilisation, revenue breakdown, members, peak-hours heatmap | Every owner / staff member; KPIs need *Analytics* |
| `/dashboard/:slug/facilities` | **Facilities & courts**: courts and pitches, opening hours, dynamic pricing, equipment, maintenance log | *Facilities & pricing* or *Equipment & maintenance* |
| `/dashboard/:slug/staff` | **Staff & payroll**: roster, billable hours, Stripe Connect splits, payout report | *Members* or *Billing* (pay terms and payroll need *Billing*) |
| `/dashboard/:slug/memberships` | **Memberships & passes**: plans, selling passes, credits and expiry | *Members* |
| `/dashboard/:slug/schedule` | **Bookings & schedule**: day view per facility, desk bookings | *Bookings & schedule* |
| `/dashboard/:slug/billing` | **Billing & Stripe Connect**: Connect account state, 30-day money flow, transaction history | *Billing* |
| `/dashboard/:slug/staff/payout-report?month=YYYY-MM` | CSV payout report | *Billing* |

The sidebar only lists the sections a member can open; phones get a menu
button instead.

## Try it

```bash
npm run db:seed   # local database only
npm run dev
```

Sign in with "Continue with email" (codes print in the dev terminal):

- `owner01@demo.nexport.test`: owner of **Padel Central**, which has six
  glass courts with peak / off-peak pricing, five months of rentals, coached
  clinics paid through Stripe Connect, memberships, staff and equipment.
- `staff01@demo.nexport.test`: Padel Central's front desk, with only
  *Bookings & schedule* and *Members*. Compare what they see.
- `owner02@demo.nexport.test`: owner of another club. Padel Central is a 404 for them.

## Access control

- **Who's in:** an `ACTIVE` `ClubMember` row with role `OWNER` or `STAFF` in
  that club (`requireClubAccess()` in `src/modules/clubs/dal.ts`). Students and
  coaches of the club, owners of other clubs, and admins get a plain **404**,
  so slugs can't be probed. Admins support a club by impersonating its owner.
- **What they can do:** owners hold every permission; staff hold the ones
  granted on their row (`ClubPermission`). The layout, every page and every
  Server Action check again on their own: actions are public endpoints and
  layouts don't re-render on client navigation.
- **No self-promotion:** only the owner adds or removes *staff* and changes
  permissions. Staff with *Members* can add coaches, but can't set pay terms
  or see wages; that needs *Billing*.
- **Suspended clubs** (suspended from `/admin`) are read-only: a banner, no
  forms, and every action refuses on the server.
- **Plan limits:** a club's plan (its live subscription, else Club Basic)
  caps active facilities, staff + coaches, and active members. The club row
  is locked while counting, so two concurrent additions can't both slip
  under a limit.
- **Input:** every form is parsed by zod on the server (`lib/forms.ts`):
  money and percentages exactly into cents and basis points, times on a
  15-minute grid, ids as `[a-z0-9]`, free text through `plainText()` (no
  control, bidi or invisible characters). Prices are always computed on the
  server, never taken from the form. Queries are parameterised; search terms
  are bound `ILIKE` patterns with wildcards escaped. The CSV export
  neutralises spreadsheet formulas.

## How things are counted

All local times (opening hours, price windows, months, the heatmap) use the
club's time zone.

| Figure | Definition |
| --- | --- |
| Court utilisation | Hours booked (coached sessions + court rentals, not cancelled) in the last 30 days ÷ opening hours of active facilities over the same 30 days. |
| Revenue | Money that reaches the club, by month of payment: Stripe Connect transfers to the club (pending or paid, net of reversals) plus payments taken at the desk. **Court rentals**, **coaching commissions** (the club's share of paid sessions) and **membership sales** are shown separately. Complimentary bookings and passes count as nothing. |
| Active members | `STUDENT` members with status `ACTIVE`. Selling a pass makes the buyer one. |
| Pass holders | Members with a pass valid now: started, not expired, not cancelled, credits left. |
| Peak hours | Booked facility-minutes per weekday × hour over the last 28 days (four of each weekday) ÷ what the active facilities could hold. |
| Billable hours | Hours of a coach's **completed** sessions that started in the month. |
| Wages due | Employees: billable hours × hourly wage. Freelancers are paid by Stripe Connect splits, shown as paid / pending / failed. |

## Dynamic pricing

A facility has a standard hourly rate. Price windows override it on chosen
weekdays (e.g. Mon–Fri 18:00–22:00 peak at €32/h). A booking is charged per
15-minute slot at the rate of the window the slot starts in, so 17:30–19:00
with peak from 18:00 is 30 minutes standard + 60 minutes peak
(`lib/pricing.ts`). Windows on the same facility and day can't overlap, which
the database enforces (`FacilityPriceRule_no_overlap`).

## Database guards

Migration `0006_club_guards.sql` adds, in the style of the Step 1 guards
(SQLSTATE 23P01, stable constraint names, tested in `tests/db/`):

- `FacilityBooking_no_overlap`: two court rentals can't overlap.
- `Facility_booking_overlap`: a rental and a coached session can't overlap
  either. An exclusion constraint can't span two tables, so a trigger on each
  side locks the facility row and checks the other table. The race test runs
  a rental and a session for the same slot at the same moment, at every
  isolation level: exactly one wins.
- `EquipmentMaintenance_capacity`: no more units in repair than exist. Units
  in repair are also taken out of the bookable stock by the equipment
  booking guard, and stock can't be cut below repairs + reservations.

`PaymentTransaction` now covers court rentals and memberships as well as
sessions: `kind` says which, and a CHECK makes sure exactly the matching
target column is set. Composite foreign keys make sure a rental or pass is
paid to the club that owns it.

## Tests

```bash
DATABASE_URL=postgresql://… npm run test:e2e:club
```

Seeds the demo data and checks 68 things in a real browser: tenant isolation
and staff permissions (including the CSV route), KPI values against the
database, facility limits, hostile input, price windows and overlap
rejection, maintenance counts, dynamic prices, double-booking and
rental-vs-clinic conflicts, memberships and credits, granting permissions,
the payout CSV, billing filters, suspension enforced on the server, creating
a club, no horizontal scroll at 375px, and no console errors. Unit tests
cover time zones (including daylight-saving gaps), pricing, permissions and
the form parsers (`src/modules/clubs/lib/clubs-lib.test.ts`).

## Not wired up yet

- **Stripe.** Online payments, transfers and the Connect account are read
  from the database; creating Connect onboarding links and taking online
  payments belong to the Stripe integration (Step 4). Desk payments work now.
- **Front-desk shifts.** Billable hours come from coached sessions, so staff
  who don't coach show 0 hours; shift tracking isn't modelled.
- **Invitations.** Adding someone to the roster takes effect immediately for
  an existing account; there's no accept / decline step yet. Looking someone
  up by email also tells staff whether that email has an account.
