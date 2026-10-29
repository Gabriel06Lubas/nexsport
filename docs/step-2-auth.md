# Step 2 — Authentication: OAuth (Google, Apple), sessions, RBAC

Sign-in is **OAuth-only** through Auth.js v5 (`next-auth@5.0.0-beta.32`) with
Google and Apple. nexport never handles a password. Sessions are
**server-side, in Postgres**, and access is enforced in a **Data Access Layer**
next to the data.

## Files

| File | Purpose |
| --- | --- |
| `src/modules/auth/auth.ts` | Auth.js config: providers, session policy, callbacks |
| `src/modules/auth/adapter.ts` | Drizzle adapter: hashed tokens, absolute lifetime, device info, no stored provider tokens |
| `src/modules/auth/providers.ts` | Google & Apple setup; Apple client-secret JWT minted from the `.p8` key |
| `src/modules/auth/dal.ts` | `getCurrentUser`, `requireUser`, `requireOnboardedUser`, `requireArea` |
| `src/modules/auth/actions.ts` | Server actions: sign in/out, revoke sessions, unlink provider, onboarding |
| `src/modules/auth/lib/*` | Pure, unit-tested rules: session policy, redirects, roles, device labels |
| `src/proxy.ts` | Optimistic redirect to `/login` when there's no session cookie (Next 16's replacement for `middleware.ts`) |
| `src/app/(auth)/login` | Sign-in page |
| `src/app/(app)/onboarding` | One-time role + profile handle step |
| `src/app/(app)/dashboard/*` | Role areas (`club`, `coach`, `athlete`) and `settings/security` |
| `src/db/schema/auth.ts` | `User`, `Account`, `Session`, `Profile` tables |
| `e2e/auth.e2e.mjs` | Browser end-to-end test against a mock OpenID provider |

## Sign-in flow

```
/login ──► Continue with Google/Apple ──► provider ──► /api/auth/callback/<provider>
                                                         │
                       signIn callback: OIDC + verified email, else AccessDenied
                                                         │
             new user? ──► /onboarding (pick role, @handle) ──► role dashboard
             returning ──► callbackUrl (validated) or /dashboard ──► role dashboard
```

| Role | Home | Can open |
| --- | --- | --- |
| `CLUB_OWNER`, `STAFF` | `/dashboard/club` | club |
| `COACH` | `/dashboard/coach` | coach |
| `STUDENT` | `/dashboard/athlete` | athlete |
| `SUPER_ADMIN` | `/dashboard/club` | all |

During onboarding users can choose athlete, coach or club owner. `STAFF` is
granted by a club and `SUPER_ADMIN` by the platform. Onboarding runs once:
the update is conditional on `onboardedAt IS NULL`, so re-posting the form
can't be used to switch roles.

## Session design

### Why database sessions instead of JWTs

The original plan put `role` and `clubId` in a JWT so the edge middleware could
check roles. Two things changed that:

1. **Revocation.** A JWT stays valid until it expires. Signing out, "sign out
   everywhere", removing a lost phone and suspending an account all need to
   take effect *now*. With database sessions they do: the row is deleted, and
   the next request fails.
2. **Fresh authorization data.** With a JWT, a role or club change waits for
   the token to be reissued. Here the session callback reads the user on every
   request, so changes apply immediately.

The cost is one indexed lookup per request (`Session.tokenHash` is unique).
Next 16 also no longer needs JWTs for this: its proxy runs on Node, and
Next's own guidance is to keep the proxy optimistic and authorize in a DAL.

### Policies

| Practice | How |
| --- | --- |
| Opaque, high-entropy token | Auth.js generates a random UUID; the cookie holds only that |
| Tokens hashed at rest | The DB stores `SHA-256(token)` (`Session.tokenHash`, CHECK-constrained to 64 hex chars). A database leak yields no usable sessions |
| Cookie flags | `httpOnly`, `SameSite=Lax`, `Path=/`; `Secure` and the `__Secure-` prefix on HTTPS |
| Idle timeout | 14 days without activity |
| Sliding refresh, throttled | Expiry moves forward at most once a day, so one write per active user per day |
| Absolute lifetime | 60 days from sign-in, however active (`createdAt` is checked on every read). A stolen cookie has a hard end date |
| Server-side sign-out | Sign-out deletes the row; replaying the old cookie fails |
| Device list | `userAgent` is stored per session; users see each device and can revoke it (`/dashboard/settings/security`) |
| Sign out others / everywhere | One click each |
| Expired-session cleanup | Expired sessions are deleted when read, and all of a user's expired sessions are deleted on each new sign-in |
| Suspended users | Soft-deleted users (`deletedAt`) can't sign in and their sessions stop working |

All values live in `src/modules/auth/lib/session-policy.ts`.

### Authorization: where checks happen

- **`src/proxy.ts`**: only checks that a session cookie exists and redirects
  to `/login?callbackUrl=…` if not. It does no database work and isn't trusted
  for anything.
- **DAL (`src/modules/auth/dal.ts`)**: the real check. Every protected page
  calls `requireUser` / `requireOnboardedUser` / `requireArea`, and every
  server action calls `requireUser` before touching data.
- **Layouts don't guard.** They don't re-run on client navigation (Next
  docs), so `(app)/layout.tsx` only *reads* the user to draw the header.
- Mutations are scoped to the caller, e.g. revoking a session deletes
  `WHERE id = ? AND userId = <current user>`.

## OAuth hardening

| Concern | Handling |
| --- | --- |
| Account takeover via email linking | Google and Apple accounts with the same email link to one user, but only when the provider reports `email_verified`. Unverified identities are refused (`AccessDenied`) and no user is created |
| CSRF / login CSRF | Auth.js `state` + PKCE (Google) and `state` + `nonce` (Apple). Next.js Server Actions check the request origin |
| Open redirect | `callbackUrl` must be a same-site relative path (`safeCallbackUrl`, unit-tested against `//evil.com`, `/\evil.com`, control characters and more). Auth.js also restricts redirects to its own origin |
| Provider tokens | Not stored. Only `provider` and `providerAccountId` are kept, since nexport needs identity, not Google/Apple API access |
| Apple `form_post` | Apple returns users with a cross-site POST. Auth.js already sends `state`/`nonce` as `SameSite=None` for that; nexport also relaxes the `callback-url` cookie, without which users landed on `/` after an Apple sign-in (caught by the e2e test). The session cookie stays `Lax` |
| Apple client secret | Minted as a 24-hour ES256 JWT from the `.p8` key and cached in memory, so there's no 6-month token to rotate by hand |
| Locking yourself out | The last connected provider can't be disconnected |

## Setting up providers

Copy `.env.example` to `.env`, then:

1. **`AUTH_SECRET`**: `openssl rand -base64 33`.
2. **`AUTH_URL`**: the public URL (`https://app.example.com`). Required in
   production.
3. **Google**: in Google Cloud Console → APIs & Services → Credentials, create
   an *OAuth client ID* of type *Web application*. Add the redirect URI
   `<AUTH_URL>/api/auth/callback/google`, then set `AUTH_GOOGLE_ID` and
   `AUTH_GOOGLE_SECRET`.
4. **Apple** (needs an Apple Developer account):
   - Create an *App ID* with "Sign in with Apple" enabled.
   - Create a *Services ID*; this is `AUTH_APPLE_ID`. Configure it with your
     domain and the return URL `<AUTH_URL>/api/auth/callback/apple`. Apple
     requires HTTPS and doesn't accept `localhost`; for local testing use a
     tunnel (e.g. `ngrok`) and set `AUTH_URL` to it.
   - Create a *Key* with "Sign in with Apple". Its ID is `AUTH_APPLE_KEY_ID`,
     and the downloaded `.p8` contents go in `AUTH_APPLE_PRIVATE_KEY` (newlines
     may be written as `\n`).
   - `AUTH_APPLE_TEAM_ID` is shown at the top right of the developer portal.

Each provider only appears on `/login` when all its variables are set.

## Testing

```bash
npm test                                  # unit tests (redirects, roles, session policy, …)
DATABASE_URL=postgresql://… npm run test:e2e
```

`test:e2e` starts the app (`next dev`), a mock OpenID Connect server standing in
for Google and Apple, and a relay on a different site (`127.0.0.1`) that
replays Apple's cross-site `form_post`. A real Chromium then runs 29 checks:

- Signed-out redirect with `callbackUrl`; open-redirect attempt blocked.
- First sign-in → onboarding → role dashboard; returning user skips onboarding.
- Cookie flags; the DB holds only the token hash; no provider tokens stored;
  device recorded.
- RBAC redirects; onboarding can't be re-run.
- Apple via a genuine cross-site POST, linked to the same user by verified
  email, returning to the requested page.
- Unverified email refused, no user created.
- Revoking a device, idle timeout, absolute lifetime, sign-out (and cookie
  replay), sign out everywhere, last provider can't be disconnected.

Test-only switches: `AUTH_GOOGLE_ISSUER` / `AUTH_APPLE_ISSUER` point a provider
at the mock server. They're ignored when `NODE_ENV=production`.

## Not covered yet

- **Rate limiting** sign-in and the session-management actions. Best placed
  at the edge or reverse proxy.
- **Admin tooling** to grant `STAFF` / `SUPER_ADMIN` and suspend users. The
  session layer already honours `deletedAt`.
- **Account deletion** (GDPR self-service).
- **Real Google/Apple sign-in.** It needs your credentials, so it hasn't been
  exercised here; the provider code paths have been tested against the mock
  server.
