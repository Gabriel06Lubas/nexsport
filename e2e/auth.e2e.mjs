// End-to-end test of sign-in, sessions and RBAC against a real browser,
// the real Next.js app and Postgres, with Google and Apple replaced by a
// local mock OpenID Connect server.
//
//   DATABASE_URL=postgresql://... npm run test:e2e
//
// Creates users with @e2e.test emails and deletes them afterwards.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import http from "node:http";

import { exportPKCS8, generateKeyPair } from "jose";
import { OAuth2Server } from "oauth2-mock-server";
import pg from "pg";
import { chromium } from "playwright";

const APP = "http://localhost:3300";
const ISSUER = "http://localhost:4555";
// 127.0.0.1 is a different *site* from localhost, so a form posted from
// there is a genuine cross-site POST, exactly like Apple's form_post.
const CROSS_SITE = "http://127.0.0.1:4556";
const DATABASE_URL = process.env.DATABASE_URL?.split("?")[0];
if (!DATABASE_URL) throw new Error("Set DATABASE_URL");

const sha256 = (s) => createHash("sha256").update(s).digest("hex");
// Optional: E2E_SCREENSHOTS=<dir> saves screenshots of the key screens.
// caret: "initial" stops Playwright injecting `caret-color` styles into
// inputs, which would race React hydration and trigger a (false) mismatch.
const shot = (page, name) =>
  process.env.E2E_SCREENSHOTS && page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/${name}.png`, fullPage: true, caret: "initial" });
let failures = 0;
function check(condition, message) {
  console.log(`${condition ? "ok  " : "FAIL"} ${message}`);
  if (!condition) failures++;
}

// --- Mock identity provider -------------------------------------------------
const idp = new OAuth2Server();
await idp.issuer.keys.generate("RS256");
await idp.start(4555, "localhost");
idp.issuer.url = ISSUER;
let identity = {};
idp.service.on("beforeTokenSigning", (token) => Object.assign(token.payload, identity));
// Apple answers with a cross-site POST (response_mode=form_post). Send the
// mock's redirect for Apple through a relay on another site that re-submits
// it as a form POST, to reproduce that faithfully.
idp.service.on("beforeAuthorizeRedirect", (redirect) => {
  if (redirect.url.pathname.endsWith("/callback/apple")) {
    // Mutate in place: the mock redirects with this same URL object.
    redirect.url.href = `${CROSS_SITE}/${redirect.url.search}`;
  }
});
const as = (claims) => (identity = { email_verified: true, ...claims });

// --- Cross-site form_post relay (stands in for appleid.apple.com) ----------
const relay = http.createServer((req, res) => {
  const url = new URL(req.url, CROSS_SITE);
  const fields = [...url.searchParams]
    .map(([k, v]) => `<input type="hidden" name="${k}" value="${v.replace(/"/g, "&quot;")}">`)
    .join("");
  res.setHeader("content-type", "text/html");
  res.end(`<form method="post" action="${APP}/api/auth/callback/apple">${fields}</form><script>document.forms[0].submit()</script>`);
});
await new Promise((r) => relay.listen(4556, "127.0.0.1", r));

// --- App under test ---------------------------------------------------------
const { privateKey } = await generateKeyPair("ES256", { extractable: true });
const app = spawn("npx", ["next", "dev", "-p", "3300"], {
  env: {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: "1",
    DATABASE_URL,
    AUTH_SECRET: "e2e-secret-e2e-secret-e2e-secret-e2e",
    AUTH_URL: APP,
    AUTH_GOOGLE_ID: "google-client",
    AUTH_GOOGLE_SECRET: "google-secret",
    AUTH_GOOGLE_ISSUER: ISSUER,
    AUTH_APPLE_ID: "apple-client",
    AUTH_APPLE_TEAM_ID: "TEAM123456",
    AUTH_APPLE_KEY_ID: "KEY1234567",
    AUTH_APPLE_PRIVATE_KEY: (await exportPKCS8(privateKey)).replace(/\n/g, "\\n"),
    AUTH_APPLE_ISSUER: ISSUER,
  },
  stdio: ["ignore", "pipe", "pipe"],
  detached: true, // own process group, so the whole npx → next tree can be stopped
});
let appLog = "";
app.stdout.on("data", (d) => (appLog += d));
app.stderr.on("data", (d) => (appLog += d));
for (let i = 0; ; i++) {
  try {
    if ((await fetch(`${APP}/login`)).ok) break;
  } catch {}
  if (i > 120) throw new Error(`app did not start\n${appLog}`);
  await new Promise((r) => setTimeout(r, 500));
}

const db = new pg.Client({ connectionString: DATABASE_URL });
await db.connect();
const cleanup = () => db.query(`DELETE FROM "User" WHERE email LIKE '%@e2e.test'`);
await cleanup();

const browser = await chromium.launch();
// Any browser-side error or warning (React, hydration, Next.js) fails the run.
const consoleErrors = [];
const origNewContext = browser.newContext.bind(browser);
browser.newContext = async (...args) => {
  const context = await origNewContext(...args);
  context.on("console", (m) => ["error", "warning"].includes(m.type()) && consoleErrors.push(`${m.type()} ${m.location().url}: ${m.text()}`));
  context.on("weberror", (e) => consoleErrors.push(e.error().message));
  return context;
};

async function signIn(context, provider) {
  const page = await context.newPage();
  await page.goto(`${APP}/login`);
  await page.getByRole("button", { name: `Continue with ${provider === "google" ? "Google" : "Apple"}` }).click();
  // Done once we're back on the app and past the plain login page.
  await page.waitForURL(
    (u) => u.host === "localhost:3300" && !u.pathname.startsWith("/api/auth") && (u.pathname !== "/login" || u.searchParams.has("error")),
  );
  return page;
}

const sessionCookie = async (context) => (await context.cookies(APP)).find((c) => c.name.endsWith("authjs.session-token"));

try {
  // 1. Signed-out visitors are sent to login, keeping where they wanted to go.
  const anon = await browser.newContext();
  const anonPage = await anon.newPage();
  await anonPage.goto(`${APP}/dashboard/coach`);
  await shot(anonPage, "1-login");
  check(new URL(anonPage.url()).pathname === "/login" && new URL(anonPage.url()).searchParams.get("callbackUrl") === "/dashboard/coach", "signed-out /dashboard/coach → /login?callbackUrl=/dashboard/coach");

  // 2. Google sign-in → onboarding → role home.
  as({ sub: "google-sub-1", email: "Maria@E2E.test", name: "María Coach" });
  const laptop = await browser.newContext({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15" });
  const page = await signIn(laptop, "google");
  check(new URL(page.url()).pathname === "/onboarding", "first Google sign-in lands on onboarding");
  await shot(page, "2-onboarding");
  await page.getByText("Coach", { exact: true }).click();
  await page.getByLabel("Profile handle").fill("maria.coach");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL(`${APP}/dashboard/coach`);
  check(true, "onboarding as Coach → /dashboard/coach");
  await shot(page, "3-coach-dashboard");

  const { rows: users } = await db.query(`SELECT id, email, role, "onboardedAt" FROM "User" WHERE email LIKE '%@e2e.test'`);
  check(users.length === 1 && users[0].email === "maria@e2e.test" && users[0].role === "COACH", "one user, email normalised to lowercase, role COACH");
  const userId = users[0].id;

  const cookie = await sessionCookie(laptop);
  check(cookie?.httpOnly && cookie.sameSite === "Lax" && cookie.path === "/", "session cookie is httpOnly, SameSite=Lax, path=/");
  const { rows: sessions } = await db.query(`SELECT "tokenHash", "userAgent" FROM "Session" WHERE "userId" = $1`, [userId]);
  check(sessions.length === 1 && sessions[0].tokenHash === sha256(cookie.value), "DB stores SHA-256(token), never the raw token");
  check(!(await db.query(`SELECT 1 FROM "Session" WHERE "tokenHash" = $1`, [cookie.value])).rowCount, "raw cookie value is not a valid DB key");
  check(sessions[0].userAgent?.includes("Macintosh"), "session records the device user agent");
  const { rows: cols } = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'Account'`);
  check(!cols.some((c) => /token/.test(c.column_name)), "no provider access/refresh/id tokens are stored");

  // 3. RBAC: a coach can't open other areas.
  await page.goto(`${APP}/dashboard/club`);
  check(new URL(page.url()).pathname === "/dashboard/coach", "coach → /dashboard/club is redirected to /dashboard/coach");
  await page.goto(`${APP}/dashboard/athlete`);
  check(new URL(page.url()).pathname === "/dashboard/coach", "coach → /dashboard/athlete is redirected to /dashboard/coach");
  await page.goto(`${APP}/onboarding`);
  check(new URL(page.url()).pathname === "/dashboard/coach", "onboarding can't be re-run once completed");
  await page.goto(`${APP}/login?callbackUrl=//evil.example`);
  check(new URL(page.url()).host === "localhost:3300", "callbackUrl=//evil.example does not leave the site");

  // 4. Apple, same verified email, via a real cross-site POST → same user.
  as({ sub: "apple-sub-1", email: "maria@e2e.test", name: undefined });
  const phone = await browser.newContext({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" });
  const phonePage = await signIn(phone, "apple");
  check(new URL(phonePage.url()).pathname === "/dashboard/coach", "Apple sign-in (cross-site form_post) succeeds and returns to the requested page");
  const { rows: accounts } = await db.query(`SELECT provider FROM "Account" WHERE "userId" = $1 ORDER BY provider`, [userId]);
  check(accounts.map((a) => a.provider).join() === "apple,google", "Apple identity linked to the same user (verified email)");

  // 5. Unverified emails are refused, and no user is created.
  as({ sub: "google-sub-2", email: "unverified@e2e.test", email_verified: false });
  const stranger = await browser.newContext();
  const strangerPage = await signIn(stranger, "google");
  check(new URL(strangerPage.url()).searchParams.get("error") === "AccessDenied", "unverified email → /login?error=AccessDenied");
  check(!(await db.query(`SELECT 1 FROM "User" WHERE email = 'unverified@e2e.test'`)).rowCount, "no user created for the unverified email");

  // 6. Devices page lists both sessions; revoking one kills it immediately.
  await page.goto(`${APP}/dashboard/settings/security`);
  await shot(page, "4-security");
  check(await page.getByText("Safari on macOS").isVisible(), "devices list shows this laptop");
  check(await page.getByText("Safari on iPhone").isVisible(), "devices list shows the phone");
  await page.getByRole("listitem").filter({ hasText: "Safari on iPhone" }).getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(/revoked=one/);
  await phonePage.goto(`${APP}/dashboard/coach`);
  check(new URL(phonePage.url()).pathname === "/login", "revoked phone session is rejected on its next request");

  // 7. Absolute lifetime: a 61-day-old session is dead even if recently active.
  await db.query(`UPDATE "Session" SET "createdAt" = now() - interval '61 days' WHERE "userId" = $1`, [userId]);
  await page.goto(`${APP}/dashboard/coach`);
  check(new URL(page.url()).pathname === "/login", "session past the 60-day absolute lifetime is rejected");
  check(!(await db.query(`SELECT 1 FROM "Session" WHERE "userId" = $1`, [userId])).rowCount, "…and deleted from the database");

  // 8. Idle timeout.
  as({ sub: "google-sub-1", email: "maria@e2e.test" });
  const again = await signIn(laptop, "google");
  check(new URL(again.url()).pathname === "/dashboard/coach", "returning user signs straight in (no onboarding)");
  await db.query(`UPDATE "Session" SET expires = now() - interval '1 second' WHERE "userId" = $1`, [userId]);
  await again.goto(`${APP}/dashboard/coach`);
  check(new URL(again.url()).pathname === "/login", "idle-expired session is rejected");

  // 9. Sign out deletes the server session; replaying the old cookie fails.
  const fresh = await signIn(laptop, "google");
  const before = await sessionCookie(laptop);
  await fresh.locator("summary", { hasText: "Open account menu" }).click();
  await fresh.getByRole("button", { name: "Sign out" }).click();
  await fresh.waitForURL(/signedOut=1/);
  check(!(await db.query(`SELECT 1 FROM "Session" WHERE "tokenHash" = $1`, [sha256(before.value)])).rowCount, "sign-out deletes the session row");
  const replay = await browser.newContext();
  await replay.addCookies([{ ...before }]);
  const replayPage = await replay.newPage();
  await replayPage.goto(`${APP}/dashboard/coach`);
  check(new URL(replayPage.url()).pathname === "/login", "replaying a signed-out cookie is rejected");

  // 10. "Sign out everywhere" ends every session.
  const a = await signIn(laptop, "google");
  as({ sub: "apple-sub-1", email: "maria@e2e.test" });
  await signIn(phone, "apple");
  check(Number((await db.query(`SELECT count(*) FROM "Session" WHERE "userId" = $1`, [userId])).rows[0].count) === 2, "two live sessions before sign-out-everywhere");
  await a.goto(`${APP}/dashboard/settings/security`);
  await a.getByRole("button", { name: "Sign out everywhere" }).click();
  await a.waitForURL(/signedOut=all/);
  check(!(await db.query(`SELECT 1 FROM "Session" WHERE "userId" = $1`, [userId])).rowCount, "sign out everywhere removes all sessions");

  // 11. The last sign-in method can't be disconnected.
  as({ sub: "google-sub-1", email: "maria@e2e.test" });
  const s = await signIn(laptop, "google");
  await s.goto(`${APP}/dashboard/settings/security`);
  await s.getByRole("listitem").filter({ hasText: "Apple" }).getByRole("button", { name: "Disconnect" }).click();
  await s.waitForURL(/unlinked=1/);
  check(await s.getByRole("listitem").filter({ hasText: "Google" }).getByRole("button", { name: "Disconnect" }).isDisabled(), "last sign-in method's Disconnect is disabled");
  check(consoleErrors.length === 0, `no browser console errors or warnings${consoleErrors.length ? `:\n  ${[...new Set(consoleErrors)].join("\n  ")}` : ""}`);
} catch (e) {
  failures++;
  console.error(e);
  console.error(appLog.split("\n").slice(-40).join("\n"));
} finally {
  if (process.env.E2E_APP_LOG) (await import("node:fs")).writeFileSync(process.env.E2E_APP_LOG, appLog);
  await cleanup();
  await db.end();
  await browser.close();
  process.kill(-app.pid, "SIGTERM");
  relay.close();
  await idp.stop();
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall auth e2e checks passed");
process.exit(failures ? 1 : 0);
