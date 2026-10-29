# nexport

Multi-tenant sports management and social platform for clubs, coaches, and
athletes (football, padel, tennis, fitness, multi-sport clubs).

**Stack:** Next.js (App Router) · TypeScript (strict) · PostgreSQL + Prisma 7 ·
Auth.js v5 (RBAC) · Tailwind + shadcn/ui · Stripe Billing + Stripe Connect

## Build log

| Step | Topic | Status |
| --- | --- | --- |
| 1 | [Database schema, booking guards](docs/step-1-database.md) | ✅ |
| 2 | Auth.js v5 RBAC (JWT role + clubId, middleware) | ⏳ |
| 3 | Modular App Router + `modules/*` layout | ⏳ |
| 4 | Scheduling service + Stripe Connect PaymentIntents | ⏳ |
| — | [Marketing website](#marketing-website) | ✅ |

## Quick start

```bash
cp .env.example .env
npm install
npm run db:deploy && npm run db:generate
```

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
