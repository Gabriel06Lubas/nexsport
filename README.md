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

## Quick start

```bash
cp .env.example .env
npm install
npm run db:deploy && npm run db:generate
```
