# Coach dashboard

Coaches (`User.role = 'COACH'`) run their coaching from `/dashboard/coach`,
and students book them on a public page at `/coach/<link>`.

| Route | Section |
| --- | --- |
| `/dashboard/coach` | **Schedule & sessions**: KPIs, week timeline, "New session" modal, sessions to wrap up, next 14 days |
| `/dashboard/coach/students` | **Students & credits**: check-in (Present / Late / Absent), session passes with −1 / +1, student directory |
| `/dashboard/coach/availability` | **Booking link & rates**: public link, rates, session length, notice, weekly working hours per club |
| `/dashboard/coach/earnings` | **Earnings & Stripe**: Connect status, payouts, breakdown by stream, transaction history |
| `/coach/<link>` | Public booking page (anyone can view; booking needs an account) |

## Try it

```bash
npm run db:seed && npm run dev
```

Sign in with "Continue with email" as `coach01@demo.nexport.test` (Lucía
Romero, freelance at Padel Central: private lessons, clinics, open matches,
attendance, a punch-card student). Her booking page is `/coach/lucia-romero`.
Sign in as `athlete06@demo.nexport.test` in another browser to book her.

## Access

- **Signed in:** the proxy (`src/proxy.ts`) sends visitors without a session
  cookie to `/login`. It can't check the role: sessions are stored in the
  database, and the proxy doesn't query it (Next.js guidance).
- **COACH only:** `requireCoach()` (`src/modules/coaching/dal.ts`) runs in the
  coach layout, every page and every action. Everyone else is redirected to
  their own home: students to `/dashboard/athlete`, club owners to their
  club, admins to `/admin`.
- **Where a coach can work:** clubs where they are an `ACTIVE` `COACH` on the
  roster. Clubs add coaches on their Staff & Payroll page. A coach schedules
  only on those clubs' facilities (not at suspended clubs), offers working
  hours only there, and changes passes only there.
- **Whose data:** every query and action is filtered on the signed-in coach's
  id. Sessions, attendance and cancellations act only on the coach's own
  sessions; credit changes only on passes of their own students (assigned
  by the club, or who joined one of their sessions).

## Scheduling and double-booking

The "New session" modal validates on the server, then writes the session,
its equipment reservation and its first student in one transaction. The
database refuses, and the modal explains:

| Conflict | Guard |
| --- | --- |
| The court is used by another session | `PracticeSession_facility_no_overlap` |
| The court is rented | `Facility_booking_overlap` (trigger, migration 0006) |
| The coach is already in a session, at any club | `PracticeSession_coach_no_overlap` (new, migration 0008) |
| Not enough equipment (reservations + units in repair) | `EquipmentBooking_capacity` |
| Session full | `SessionParticipant_capacity` |

Outside the court's opening hours, in the past, and nonexistent local times
(daylight-saving gaps) are refused before that. The coach's share is copied
from the roster: the freelance commission, or 0 for club employees, who are
paid wages.

## Public booking

- Slots come from the weekly windows (club time zone), cut into session-length
  pieces, from the minimum notice up to the booking horizon. A slot is offered
  only if the coach is free and the preferred court (or any active court of
  that club) is open and free. See `lib/slots.ts`.
- Booking re-computes the open slots and refuses a time that isn't one of
  them, so a forged request can't book outside the coach's hours. The
  database settles races: two students clicking the same slot at the same
  moment get one booking and one "someone booked that slot".
- A student can hold at most 3 upcoming self-booked sessions per coach,
  since an unpaid booking holds a court.
- Price: private rate × session length. Payment is taken at the club until
  the Stripe integration (Step 4) collects it online.
- The confirmation (`?booked=<id>`) shows details only to the student who
  booked that session.

## Figures

| Figure | Definition |
| --- | --- |
| Hours scheduled | Non-cancelled sessions the coach runs, starting this week / month (coach's time zone) |
| Pending session earnings | The coach's Stripe Connect transfers with status `PENDING` |
| Average attendance rate | Of attendance marked on the coach's sessions in the last 90 days, the share Present or Late |
| Streams | Session kind: `PRIVATE` = direct private sessions, `GROUP` = club commissions, `OPEN_MATCH` = open match contributions |
| Your share | `PaymentTransfer` rows to the coach (paid or pending, net of reversals) |

## Credits

"−1 session" and "+1 back" change a pass by one credit in a single
conditional `UPDATE` (no overspending, no refunding below zero), and write a
`PassCreditAdjustment` row (who, why, when) in the same transaction. The club
desk's "Use 1 credit" writes to the same ledger.

## Tests

```bash
DATABASE_URL=postgresql://… npm run test:e2e:coach
```

52 checks in a real browser: the role gate, KPIs against the database, every
modal conflict above (and that a refused session isn't half-created),
cancelling (equipment released), completing, check-in, credit changes and the
ledger, hostile search input, booking link validation, availability overlap,
self-booking with confirmation, the 3-booking cap, two students racing for
one slot, earnings, 375px layout, and no console errors. Unit tests cover the
slot generator and the forms (`src/modules/coaching/lib/coaching-lib.test.ts`);
SQL tests cover the new guards (`tests/db/coach_guards.test.sql`).

## Not wired up yet

- **Stripe:** online payment for self-bookings and Connect onboarding links
  (Step 4). Earnings are read from the database.
- **Club coaches without the COACH role:** club employees whose platform role
  is STAFF (e.g. the seeded "Pablo Ruiz") appear in the club's payroll but
  don't get this dashboard.
- **Notifications:** coaches and students aren't emailed about bookings or
  cancellations yet.
