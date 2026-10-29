# Step 2 — Authentication: OAuth (Google, Apple), sessions, RBAC

Sign-in is **passwordless**: Google or Apple through Auth.js v5
(`next-auth@5.0.0-beta.32`), or a 6-digit code sent by email. nexport never
handles a password. Every account confirms its email with a code before it
can use the app. Sessions are **server-side, in Postgres**, and access is
enforced in a **Data Access Layer** next to the data.

## Files

| File | Purpose |
| --- | --- |
| `src/modules/auth/auth.ts` | Auth.js config: providers, session policy, callbacks |
| `src/modules/auth/adapter.ts` | Drizzle adapter: hashed tokens, absolute lifetime, device info, no stored provider tokens |
| `src/modules/auth/providers.ts` | Google & Apple setup; Apple client-secret JWT minted from the `.p8` key |
| `src/modules/auth/dal.ts` | `getCurrentUser`, `requireSignedInUser`, `requireUser` (email confirmed), `requireOnboardedUser`, `requireArea` |
| `src/modules/auth/email-code.ts` | Issuing and checking one-time email codes (rate limits, attempts, single use) |
| `src/modules/auth/email-actions.ts` | Server actions: request / resend / verify codes, for both flows |
| `src/modules/auth/session-cookie.ts` | Starts a session after email-code sign-in, identical to Auth.js's |
| `src/modules/auth/emails/verification-code.ts` | The code email (text + HTML) |
| `src/modules/notifications/email.ts` | SMTP sending (nodemailer); prints to the terminal in dev without SMTP |
| `src/lib/validation.ts` | Shared free-text rules (`plainText`, `idSchema`) |
| `src/modules/auth/actions.ts` | Server actions: sign in/out, revoke sessions, unlink provider, onboarding |
| `src/modules/auth/lib/*` | Pure, unit-tested rules: session policy, redirects, roles, device labels |
| `src/proxy.ts` | Optimistic redirect to `/login` when there's no session cookie (Next 16's replacement for `middleware.ts`) |
| `src/app/(auth)/login` | Sign-in page (Google, Apple, email) and `login/verify` (enter the code) |
| `src/app/(app)/verify-email` | "Confirm your email" step after a Google/Apple sign-up |
| `src/app/(app)/onboarding` | One-time role + profile handle step |
| `src/app/(app)/dashboard/*` | Role areas (`club`, `coach`, `athlete`) and `settings/security` |
| `src/db/schema/auth.ts` | `User`, `Account`, `Session`, `EmailCode`, `Profile` tables |
| `e2e/auth.e2e.mjs` | Browser end-to-end test against a mock OpenID provider |

## Sign-in flow

```
/login ─┬─► Continue with Google/Apple ──► provider ──► /api/auth/callback/<provider>
        │       signIn callback: OIDC + provider-verified email, else AccessDenied
        │       new account ──► code emailed automatically ──► /verify-email ──┐
        │                                                                     │
        └─► Continue with email ──► code emailed ──► /login/verify ───────────┤
                                                                              ▼
              not onboarded? ──► /onboarding (pick role, @handle) ──► role dashboard
              returning ──► callbackUrl (validated) or /dashboard ──► role dashboard
```

| Role | Home | Can open |
| --- | --- | --- |
| `CLUB_OWNER`, `STAFF` | `/dashboard/club` | club |
| `COACH` | `/dashboard/coach` | coach |
| `STUDENT` | `/dashboard/athlete` | athlete |
| `ADMIN` | `/admin` (see [admin.md](admin.md)) | all |

During onboarding users can choose athlete, coach or club owner. `STAFF` is
granted by a club, and `ADMIN` is only ever set directly in the database. Onboarding runs once:
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

## Email verification codes

Two flows use the same code machinery (`email-code.ts`):

- **Continue with email** (sign in / sign up without a password): the user
  enters an address, gets a code, and entering it creates or opens the account
  for that address, marks the email confirmed and starts a session. No account
  exists until the code is entered. If the address already belongs to a
  Google/Apple account, that same account is opened.
- **Confirm your email** after a Google/Apple sign-up: Auth.js's `createUser`
  event emails a code to the new account. `requireUser()` sends unconfirmed
  users to `/verify-email`, so nothing else in the app (onboarding, dashboards,
  settings) is reachable until they enter it. "Confirmed" is
  `User.emailVerified`, which Auth.js leaves empty for Google/Apple sign-ups.

| Protection | How |
| --- | --- |
| Unpredictable codes | 6 digits from the OS CSPRNG (`crypto.randomInt`) |
| Codes at rest | Only `HMAC-SHA256(AUTH_SECRET, codeId + code)` is stored, so a database leak neither reveals codes nor lets them be brute-forced offline |
| Expiry / single use | 10 minutes; consuming is a conditional update, so a code works once even if submitted twice at the same moment; a new code invalidates the previous one |
| Guessing | 5 attempts per code. The counter is incremented atomically **before** comparing, so parallel guesses can't get extra tries; comparison is constant-time |
| Flooding an inbox | 60 s cooldown, 5 codes per address per hour, 20 per client IP per hour (IP stored only as an HMAC). Checked under a per-address Postgres advisory lock so concurrent requests can't slip through |
| Overall odds | At most 25 guesses per address per hour against 10^6 codes (≈0.0025 %/hour) |
| Binding | A sign-in code only works in the browser that requested it: its id lives in an httpOnly cookie (`__Host-` on HTTPS), never in the URL. A confirmation code is looked up by the signed-in user's id, never by a form field |
| Account enumeration | Requesting a code looks the same whether or not the address has an account |
| Session | Email sign-in starts a session exactly like Auth.js does (hashed token, same cookie name and flags) and replaces any session the browser already had |

### Untrusted input

Every text box is parsed server-side before anything else happens:

| Field | Rule |
| --- | --- |
| Email | trimmed, lower-cased, ≤ 254 chars, valid address, **no control characters** (CR/LF would allow email header injection) |
| Code | digits only after removing spaces/dashes, exactly 6 |
| Display name | `plainText()`: NFC-normalised, 2–60 chars, no control characters (a NUL byte would make Postgres error), no bidi overrides or zero-width characters (spoofing) |
| Handle | `^[a-z0-9_.]{3,30}$` |
| Ids from forms | `^[a-z0-9]{1,64}$`, and always scoped to the signed-in user |
| `callbackUrl` | same-site relative paths only (`safeCallbackUrl`) |

SQL injection: every query goes through Drizzle, which sends values as bound
parameters; there is no `sql.raw` or string-built SQL anywhere. XSS: React
escapes all output (no `dangerouslySetInnerHTML`), and the code email contains
nothing the user typed. nodemailer runs with `disableFileAccess` and
`disableUrlAccess`, and is pinned to a release without the address-parsing
advisories that affect versions below 10.1.4. The e2e suite submits SQL and
HTML/JS payloads through the real forms and checks that nothing is stored,
executed or damaged.

### Sending email

Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` and
`EMAIL_FROM` (see `.env.example`). Any SMTP provider works. In development
without `SMTP_HOST`, emails are printed to the terminal running `npm run dev`,
code included. In production a missing SMTP configuration is an error, and
"Continue with email" is hidden.

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
replays Apple's cross-site `form_post`, plus a local SMTP server that receives
the code emails. A real Chromium then runs 49 checks:

- Signed-out redirect with `callbackUrl`; open-redirect attempt blocked.
- First sign-in → onboarding → role dashboard; returning user skips onboarding.
- Cookie flags; the DB holds only the token hash; no provider tokens stored;
  device recorded.
- RBAC redirects; onboarding can't be re-run.
- Apple via a genuine cross-site POST, linked to the same user by verified
  email, returning to the requested page.
- Unverified email refused, no user created.
- Email codes: sent automatically on Google sign-up; app locked until
  confirmed; only an HMAC stored; wrong code shows attempts left; "Continue
  with email" creates no account until the code is entered; the code page is
  useless in another browser; cooldown; 5 wrong guesses lock the code even for
  the right one; email sign-in to an existing address opens the same account.
- Malicious input: SQL in the code and email boxes is rejected before the
  database; an SQL payload as display name is stored as plain text; an HTML/JS
  payload in the email box is never executed.
- Revoking a device, idle timeout, absolute lifetime, sign-out (and cookie
  replay), sign out everywhere, last provider can't be disconnected.

Test-only switches: `AUTH_GOOGLE_ISSUER` / `AUTH_APPLE_ISSUER` point a provider
at the mock server. They're ignored when `NODE_ENV=production`.

## Not covered yet

- **Rate limiting** beyond email codes (e.g. OAuth sign-in and the
  session-management actions). Best placed at the edge or reverse proxy, which
  also makes the per-IP code limit trustworthy (`X-Forwarded-For` must be set
  by your proxy, not the client).
- **Changing the account email.** Not supported yet; it would reuse the
  VERIFY_EMAIL code flow for the new address.
- **Granting `STAFF`** from a club's dashboard (admins and suspension are
  covered in [admin.md](admin.md)).
- **Account deletion** (GDPR self-service).
- **Real Google/Apple sign-in.** It needs your credentials, so it hasn't been
  exercised here; the provider code paths have been tested against the mock
  server.
