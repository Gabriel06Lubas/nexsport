// End-to-end test of sign-in, email codes, sessions and RBAC against a real
// browser, the real Next.js app and Postgres, with Google and Apple replaced
// by a local mock OpenID Connect server and email delivered to a local SMTP
// server that the test reads codes from.
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
import { SMTPServer } from "smtp-server";

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

// --- Mailbox: a local SMTP server that keeps every message ------------------
const inbox = [];
const smtp = new SMTPServer({
  authOptional: true,
  disabledCommands: ["STARTTLS", "AUTH"],
  onData(stream, session, done) {
    let raw = "";
    stream.on("data", (chunk) => (raw += chunk));
    stream.on("end", () => {
      inbox.push({ to: session.envelope.rcptTo.map((r) => r.address.toLowerCase()), raw });
      done();
    });
  },
});
await new Promise((r) => smtp.listen(2525, "127.0.0.1", r));
const mailsTo = (address) => inbox.filter((m) => m.to.includes(address));
/** Waits for message number `n` (1-based) to `address` and returns its code. */
async function codeFor(address, n) {
  for (let i = 0; i < 100; i++) {
    const mail = mailsTo(address)[n - 1];
    const subject = mail?.raw.match(/^Subject: (\d{3}) (\d{3}) is your nexport code/m);
    if (subject) return subject[1] + subject[2];
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`no email #${n} for ${address}`);
}

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
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: "2525",
    EMAIL_FROM: "nexport <no-reply@e2e.test>",
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
const cleanup = async () => {
  await db.query(`DELETE FROM "User" WHERE email LIKE '%@e2e.test'`);
  await db.query(`DELETE FROM "EmailCode" WHERE email LIKE '%@e2e.test'`);
};
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

/** "Continue with email" on /login; fails with the page's message if no code page follows. */
async function requestEmailCode(page, address) {
  await page.getByPlaceholder("you@example.com").fill(address);
  await page.getByRole("button", { name: "Continue with email" }).click();
  try {
    await page.waitForURL((u) => u.pathname === "/login/verify", { timeout: 15000 });
  } catch {
    const message = await page.getByRole("alert").first().textContent().catch(() => "(no message)");
    throw new Error(`requesting a code for ${address} failed: ${message}`);
  }
}

/** On /verify-email, enter the newest emailed code and continue. */
async function confirmEmail(page, address) {
  const code = await codeFor(address, mailsTo(address).length || 1);
  await page.getByLabel("6-digit code").fill(code);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL((u) => !["/verify-email", "/dashboard"].includes(u.pathname));
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
  check(new URL(page.url()).pathname === "/verify-email", "first Google sign-in lands on 'Confirm your email'");
  await shot(page, "2-verify-email");
  const signupCode = await codeFor("maria@e2e.test", 1);
  check(/^\d{6}$/.test(signupCode), "a 6-digit code was emailed automatically on sign-up");
  const { rows: codeRows } = await db.query(`SELECT "codeHash", "userId" IS NOT NULL AS bound FROM "EmailCode" WHERE email = 'maria@e2e.test'`);
  check(codeRows.length === 1 && /^[0-9a-f]{64}$/.test(codeRows[0].codeHash) && !codeRows[0].codeHash.includes(signupCode) && codeRows[0].bound, "DB stores only an HMAC of the code, bound to the user");
  await page.goto(`${APP}/dashboard`);
  check(new URL(page.url()).pathname === "/verify-email", "the app stays locked until the email is confirmed");
  await page.getByLabel("6-digit code").fill("' OR '1'='1");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByText("Enter the 6-digit code").waitFor();
  const { rows: afterInjection } = await db.query(`SELECT attempts FROM "EmailCode" WHERE email = 'maria@e2e.test'`);
  check(afterInjection[0].attempts === 0, "SQL-injection text in the code box is rejected before touching the database");
  await page.getByLabel("6-digit code").fill(signupCode === "000000" ? "111111" : "000000");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByText("That code isn't right. 4 attempts left.").waitFor();
  check(true, "a wrong code is refused and the remaining attempts are shown");
  await confirmEmail(page, "maria@e2e.test");
  check(new URL(page.url()).pathname === "/onboarding", "the right code confirms the email and continues to onboarding");
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
  await page.goto(`${APP}/dashboard/student`);
  check(new URL(page.url()).pathname === "/dashboard/coach", "coach → /dashboard/student is redirected to /dashboard/coach");
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

  // 5b. Onboarding with a handle someone already has is refused, not a crash.
  as({ sub: "google-sub-3", email: "second@e2e.test", name: "Second User" });
  const second = await browser.newContext();
  const secondPage = await signIn(second, "google");
  await confirmEmail(secondPage, "second@e2e.test");
  const sqlName = `Robert'); DROP TABLE "User";--`;
  await secondPage.getByLabel("Display name").fill(sqlName);
  await secondPage.getByLabel("Profile handle").fill("maria.coach");
  await secondPage.getByRole("button", { name: "Continue" }).click();
  await secondPage.getByText("That handle is taken").waitFor();
  check(new URL(secondPage.url()).pathname === "/onboarding", "taken handle → 'That handle is taken', stays on onboarding");
  await secondPage.getByLabel("Profile handle").fill("second.user");
  await secondPage.getByRole("button", { name: "Continue" }).click();
  await secondPage.waitForURL(`${APP}/dashboard/student`);
  check(true, "a free handle then completes onboarding (athlete by default)");
  const { rows: stored } = await db.query(`SELECT "displayName" FROM "Profile" WHERE handle = 'second.user'`);
  check(stored[0]?.displayName === sqlName && (await db.query(`SELECT to_regclass('public."User"') IS NOT NULL AS ok`)).rows[0].ok, "an SQL payload as display name is stored as plain text; nothing is executed");

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

  // 12. "Continue with email": sign-up with a code, no password.
  const emailUser = await browser.newContext();
  const ep = await emailUser.newPage();
  await ep.goto(`${APP}/login`);
  await shot(ep, "5-login-email");
  await requestEmailCode(ep, "Newbie@E2E.test");
  check(!(await db.query(`SELECT 1 FROM "User" WHERE email = 'newbie@e2e.test'`)).rowCount, "requesting a code creates no account yet");
  const pendingCookie = (await emailUser.cookies(APP)).find((c) => c.name.endsWith("nexport.email-sign-in"));
  check(pendingCookie?.httpOnly && pendingCookie.sameSite === "Lax", "the pending sign-in is bound to this browser by an httpOnly cookie");
  await shot(ep, "6-enter-code");
  const elsewhere = await (await browser.newContext()).newPage();
  await elsewhere.goto(`${APP}/login/verify`);
  check(new URL(elsewhere.url()).pathname === "/login", "the code page is useless in another browser");
  await ep.getByLabel("6-digit code").fill(await codeFor("newbie@e2e.test", 1));
  await ep.getByRole("button", { name: "Continue" }).click();
  await ep.waitForURL((u) => u.pathname === "/onboarding");
  const { rows: newbie } = await db.query(`SELECT "emailVerified" FROM "User" WHERE email = 'newbie@e2e.test'`);
  check(newbie.length === 1 && newbie[0].emailVerified, "the code creates the account with a confirmed email and signs in → onboarding");
  check(Boolean(await sessionCookie(emailUser)), "email sign-in sets the same kind of session cookie as Google/Apple");

  // 13. Cooldown and brute force on one pending code.
  const attacker = await (await browser.newContext()).newPage();
  await attacker.goto(`${APP}/login`);
  await requestEmailCode(attacker, "target@e2e.test");
  await attacker.getByRole("button", { name: "Send a new code" }).click();
  await attacker.getByText(/Please wait \d+ seconds/).waitFor();
  check(true, "asking for another code right away is refused (cooldown)");
  const realCode = await codeFor("target@e2e.test", 1);
  const wrong = realCode === "123456" ? "654321" : "123456";
  for (let i = 0; i < 5; i++) {
    await attacker.getByLabel("6-digit code").fill(wrong);
    await attacker.getByRole("button", { name: "Continue" }).click();
    await attacker.getByText(i < 4 ? `${4 - i} attempt` : "expired or was tried too many times").first().waitFor();
  }
  await attacker.getByLabel("6-digit code").fill(realCode);
  await attacker.getByRole("button", { name: "Continue" }).click();
  await attacker.getByText("expired or was tried too many times").first().waitFor();
  check(!(await db.query(`SELECT 1 FROM "User" WHERE email = 'target@e2e.test'`)).rowCount, "after 5 wrong guesses even the right code no longer works");

  // 14. Email sign-in to an existing Google account's address → same account.
  // Maria's sign-up code is seconds old; let the 60-second cooldown pass.
  await db.query(`UPDATE "EmailCode" SET "createdAt" = now() - interval '2 minutes' WHERE email = 'maria@e2e.test'`);
  const viaEmail = await (await browser.newContext()).newPage();
  await viaEmail.goto(`${APP}/login`);
  await requestEmailCode(viaEmail, "maria@e2e.test");
  await viaEmail.getByLabel("6-digit code").fill(await codeFor("maria@e2e.test", 2));
  await viaEmail.getByRole("button", { name: "Continue" }).click();
  await viaEmail.waitForURL((u) => u.pathname === "/dashboard/coach");
  check(Number((await db.query(`SELECT count(*) FROM "User" WHERE email = 'maria@e2e.test'`)).rows[0].count) === 1, "email sign-in with an existing address opens that same account");

  // 15. Malicious text in the email box: rejected, nothing stored or run.
  const mal = await (await browser.newContext()).newPage();
  await mal.goto(`${APP}/login`);
  for (const payload of [`' OR 1=1 --@e2e.test`, `"<img src=x onerror=window.__xss=1>"@e2e.test`, `a@e2e.test'; DROP TABLE "EmailCode";--`]) {
    await mal.getByPlaceholder("you@example.com").fill(payload);
    await mal.getByRole("button", { name: "Continue with email" }).click();
    await mal.getByText("Enter a valid email address").waitFor();
  }
  check(!(await mal.evaluate(() => window.__xss)), "an HTML/JS payload in the email box is shown as text, never run");
  check((await db.query(`SELECT to_regclass('public."EmailCode"') IS NOT NULL AS ok`)).rows[0].ok && !(await db.query(`SELECT 1 FROM "EmailCode" WHERE email LIKE '%drop%' OR email LIKE '%or 1=1%'`)).rowCount, "SQL payloads in the email box are rejected; no rows, no damage");

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
  smtp.close();
  await idp.stop();
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall auth e2e checks passed");
process.exit(failures ? 1 : 0);
