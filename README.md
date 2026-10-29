# nexport

Multi-tenant sports management and social platform for clubs, coaches, and
athletes (football, padel, tennis, fitness, multi-sport clubs).

**Stack:** Next.js (App Router) · TypeScript (strict) · PostgreSQL + Drizzle ORM ·
Auth.js v5 (RBAC) · Tailwind + shadcn/ui · Stripe Billing + Stripe Connect

## Build log

| Step | Topic | Status |
| --- | --- | --- |
| 1 | [Database schema, booking guards](docs/step-1-database.md) | ✅ |
| 2 | [Sign-in (Google, Apple, email code), email verification, sessions, RBAC](docs/step-2-auth.md) | ✅ |
| 3 | Modular App Router + `modules/*` layout | ⏳ |
| 4 | Scheduling service + Stripe Connect PaymentIntents | ⏳ |
| — | [Admin dashboard](docs/admin.md): KPIs, tenants, plans, financials, logs, impersonation | ✅ |
| — | [Marketing website](#marketing-website) | ✅ |

## Quick start

Requires Node.js 20.9 or newer.

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # production build
```

The website runs without a database or `.env`. To sign in you also need the
database and at least one OAuth provider:

```bash
cp .env.example .env   # then set AUTH_SECRET (Google/Apple keys and SMTP are optional in dev:
                       # "Continue with email" prints its codes in the `npm run dev` terminal)
```

Then:

```bash
npm run db:up          # terminal 1: local PostgreSQL on localhost:5432 (leave it running)
npm run db:migrate     # terminal 2: create the tables
npm run db:seed        # optional: demo clubs, coaches and payments (local only)
npm run db:studio      # optional: browse the data in Drizzle Studio
npm run dev            # then open http://localhost:3000/login
```

The database layer (Drizzle ORM) is described in [docs/database.md](docs/database.md).

## Marketing website

The public site lives in the `src/app/(marketing)` route group. It has its own
layout (header and footer) and doesn't need a database or sign-in.

| Route | Content |
| --- | --- |
| `/` | Overview, audience cards, live scheduling and payout demos, module grid |
| `/clubs` | Dashboard & analytics, facilities, equipment, roles & permissions |
| `/coaches` | Session planning demo, attendance & feedback demo, payout calculator |
| `/athletes` | Invite demo, messaging, profile, feed, notifications |
| `/features` | Every capability, grouped by module (from `src/config/features.ts`) |
| `/sports` | Football, padel, tennis, fitness, basketball, multi-sport |
| `/pricing` | Plans (`src/config/pricing.ts`), payout calculator, refund policies, FAQ |
| `/trust` | Double-booking, capacity, payment and data-isolation guarantees |
| `/contact` | Demo request (opens the visitor's email app; no backend) |

The interactive demos run the real domain logic from `src/modules/*/lib`
(booking overlap, equipment availability, fee split, refund policy), the same
code the app will use. Plan prices and the contact address are placeholders.

```bash
npm run dev        # http://localhost:3000
npm test           # unit tests for the shared domain logic
npm run build      # production build (all marketing pages are static)
```
