// End-to-end test of the admin dashboard: access control, KPIs, tenant
// search, plan editing, suspension and impersonation, against a real browser,
// the real app and Postgres with demo data (scripts/seed-demo.mjs).
//
//   DATABASE_URL=postgresql://... npm run test:e2e:admin
//
// Inserts the admin the documented way (a row in "User"), signs in with an
// email code, and cleans up its own rows afterwards.
import { spawn, spawnSync } from "node:child_process";

import pg from "pg";
import { chromium } from "playwright";
import { SMTPServer } from "smtp-server";

const APP = "http://localhost:3400";
const DATABASE_URL = process.env.DATABASE_URL?.split("?")[0];
if (!DATABASE_URL) throw new Error("Set DATABASE_URL");
const ADMIN_EMAIL = "admin@e2e-admin.test";

let failures = 0;
function check(condition, message) {
  console.log(`${condition ? "ok  " : "FAIL"} ${message}`);
  if (!condition) failures++;
}
const shot = (page, name) =>
  process.env.E2E_SCREENSHOTS && page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/${name}.png`, fullPage: true, caret: "initial" });

// --- Demo data ---------------------------------------------------------------
const seeded = spawnSync("node", ["scripts/seed-demo.mjs"], { env: { ...process.env, DATABASE_URL }, encoding: "utf8" });
if (seeded.status !== 0) throw new Error(`seeding failed:\n${seeded.stderr}`);

// --- Mailbox -----------------------------------------------------------------
const inbox = [];
const smtp = new SMTPServer({
  authOptional: true,
  disabledCommands: ["STARTTLS", "AUTH"],
  onData(stream, session, done) {
    let raw = "";
    stream.on("data", (c) => (raw += c));
    stream.on("end", () => (inbox.push({ to: session.envelope.rcptTo.map((r) => r.address.toLowerCase()), raw }), done()));
  },
});
await new Promise((r) => smtp.listen(2526, "127.0.0.1", r));
async function latestCode(address) {
  for (let i = 0; i < 100; i++) {
    const mails = inbox.filter((m) => m.to.includes(address));
    const subject = mails.at(-1)?.raw.match(/^Subject: (\d{3}) (\d{3}) is your nexport code/m);
    if (subject) return subject[1] + subject[2];
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`no code for ${address}`);
}

// --- App -----------------------------------------------------------------------
const app = spawn("npx", ["next", "dev", "-p", "3400"], {
  env: {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: "1",
    DATABASE_URL,
    AUTH_SECRET: "e2e-admin-secret-e2e-admin-secret-xx",
    AUTH_URL: APP,
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: "2526",
    EMAIL_FROM: "nexport <no-reply@e2e-admin.test>",
  },
  stdio: ["ignore", "pipe", "pipe"],
  detached: true,
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
const one = async (text, params) => (await db.query(text, params)).rows[0];
const cleanup = async () => {
  await db.query(`DELETE FROM "AdminAuditLog" WHERE "actorEmail" = $1`, [ADMIN_EMAIL]);
  await db.query(`DELETE FROM "User" WHERE email = $1`, [ADMIN_EMAIL]);
  await db.query(`DELETE FROM "EmailCode" WHERE email = $1 OR email LIKE '%@demo.nexport.test'`, [ADMIN_EMAIL]);
};
await cleanup();
// Start from the plan values migration 0004 seeds, whatever earlier runs saved.
await db.query(`
  UPDATE "SubscriptionPlan" p SET name = d.name, "monthlyPriceAmount" = d.price, "platformFeeBps" = d.fee, "stripePriceId" = NULL,
         "isActive" = d.active, "updatedById" = NULL, "updatedAt" = now()
    FROM (VALUES ('FREE_COACH', 'Free Coach', 0, 1000, true), ('PRO_COACH', 'Pro Coach', 2900, 500, false),
                 ('CLUB_BASIC', 'Club Basic', 4900, 600, false), ('CLUB_ENTERPRISE', 'Club Enterprise', 14900, 300, false))
         AS d(tier, name, price, fee, active)
   WHERE p.tier::text = d.tier`);
// The documented way to create an admin: insert the row directly.
await db.query(
  `INSERT INTO "User"(id, email, name, role, "emailVerified", "onboardedAt", "updatedAt")
   VALUES ('e2eadmin01', $1, 'Platform Admin', 'ADMIN', now(), now(), now())`,
  [ADMIN_EMAIL],
);

const browser = await chromium.launch();
const consoleErrors = [];
const newContext = async () => {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  context.on("console", (m) => ["error", "warning"].includes(m.type()) && !m.text().includes("404") && consoleErrors.push(`${m.type()}: ${m.text()}`));
  context.on("weberror", (e) => consoleErrors.push(e.error().message));
  return context;
};

async function emailSignIn(context, address) {
  const page = await context.newPage();
  await page.goto(`${APP}/login`);
  await page.getByPlaceholder("you@example.com").fill(address);
  await page.getByRole("button", { name: "Continue with email" }).click();
  await page.waitForURL((u) => u.pathname === "/login/verify");
  await page.getByLabel("6-digit code").fill(await latestCode(address));
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login") && u.pathname !== "/dashboard");
  return page;
}

async function openTenantAction(page, rowText, action) {
  await page.getByRole("row").filter({ hasText: rowText }).getByLabel(/^Actions for/).click();
  await page.getByRole("button", { name: action }).click();
  return page.getByRole("dialog");
}

try {
  // 1. Access control.
  const anon = await (await newContext()).newPage();
  await anon.goto(`${APP}/admin`);
  check(new URL(anon.url()).pathname === "/login", "signed-out /admin → /login");

  const athleteContext = await newContext();
  const athlete = await emailSignIn(athleteContext, "athlete01@demo.nexport.test");
  for (const path of ["/admin", "/admin/tenants", "/admin/subscriptions", "/admin/financials", "/admin/logs", "/admin/tenants/club/democlub01"]) {
    const response = await athlete.goto(`${APP}${path}`);
    const leaked = await athlete.getByText("Tenants & Clubs").count();
    check(response.status() === 404 && leaked === 0, `non-admin gets a plain 404 on ${path} (no admin navigation)`);
  }

  // 2. Admin sign-in lands on the overview with correct KPIs.
  const adminContext = await newContext();
  const admin = await emailSignIn(adminContext, ADMIN_EMAIL);
  check(new URL(admin.url()).pathname === "/admin", "admin signs in (email code) and lands on /admin");
  await shot(admin, "admin-1-overview");
  const kpi = async (label) => (await admin.getByRole("region", { name: label, exact: true }).textContent()) ?? "";
  check((await kpi("Platform MRR")).includes("€354.00"), "MRR = €354.00 (active + past due; trials and cancelled excluded)");
  check((await kpi("Active tenants")).includes("10") && (await kpi("Active tenants")).includes("5 clubs · 5 coaches (2 pro)"), "active tenants = 10 (5 active clubs + 5 coaches, 2 pro)");
  check((await kpi("Stripe Connect health")).includes("71.4%"), "Connect health = 71.4% (5 of 7 accounts)");
  // The seed's club-dashboard data adds rentals, clinics and memberships, so the
  // expected total comes from the database (all SUCCEEDED payments, before refunds).
  const { volume } = await one(`SELECT sum(amount)::int AS volume FROM "PaymentTransaction" WHERE status = 'SUCCEEDED'`);
  const expectedVolume = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(volume / 100);
  check((await kpi("Total volume processed")).includes(expectedVolume), `total volume = ${expectedVolume} across all clubs`);
  check(await admin.getByText("Summit Multi-Sport").first().isVisible(), "activity feed shows the newest club signup");

  // 3. Tenants table: search, filters, wildcard and injection safety.
  await admin.goto(`${APP}/admin/tenants`);
  await shot(admin, "admin-2-tenants");
  check(await admin.getByText("11 tenants").isVisible(), "tenant table lists 6 clubs + 5 independent coaches");
  const padelRow = admin.getByRole("row").filter({ hasText: "Padel Central" });
  const padelText = (await padelRow.textContent()) ?? "";
  check(
    padelText.includes("owner01@demo.nexport.test") && padelText.includes("Club Enterprise") && padelText.includes("6") && padelText.includes("Connected"),
    "row shows owner email, plan, facilities and Connect status",
  );
  await admin.goto(`${APP}/admin/tenants?q=padel`);
  check(await admin.getByText("2 tenants").isVisible(), "search 'padel' finds the 2 padel clubs");
  await admin.goto(`${APP}/admin/tenants?type=coach`);
  check(await admin.getByText("5 tenants").isVisible(), "type filter shows only independent coaches");
  await admin.goto(`${APP}/admin/tenants?q=${encodeURIComponent("%")}`);
  check(await admin.getByText("No tenants match").isVisible(), "a '%' search is literal, not a wildcard that matches everything");
  const injected = await admin.goto(`${APP}/admin/tenants?q=${encodeURIComponent("' OR 1=1 --")}&type=${encodeURIComponent("club' OR '1'='1")}&page=abc`);
  check(injected.status() === 200 && (await admin.getByText("No tenants match").isVisible()), "SQL in search/type/page params is inert (no error, no rows)");
  for (const bad of ["/admin/tenants/foo/democlub01", "/admin/tenants/club/DEMO", "/admin/tenants/club/nope000"]) {
    check((await admin.goto(`${APP}${bad}`)).status() === 404, `bad tenant URL ${bad} → 404`);
  }
  await admin.goto(`${APP}/admin/tenants/club/democlub01`);
  check(await admin.getByText("Active facilities").isVisible(), "tenant detail page opens");

  // 4. Suspend a coach: sessions revoked, sign-in refused, audited.
  const coachContext = await newContext();
  const coach = await emailSignIn(coachContext, "coach02@demo.nexport.test");
  check(new URL(coach.url()).pathname === "/dashboard/coach", "demo coach is signed in");
  await admin.goto(`${APP}/admin/tenants?type=coach`);
  let dialog = await openTenantAction(admin, "Tom Becker", "Suspend tenant");
  await dialog.getByLabel(/Reason/).fill("abc");
  await dialog.getByRole("button", { name: "Suspend" }).click();
  await dialog.getByText("Use at least 5 characters").waitFor();
  check(true, "a suspension needs a real reason");
  await dialog.getByLabel(/Reason/).fill("Chargeback abuse under review");
  await dialog.getByRole("button", { name: "Suspend" }).click();
  await dialog.getByText("has been suspended").waitFor();
  const suspended = await one(`SELECT "suspendedAt" IS NOT NULL AS s, (SELECT count(*)::int FROM "Session" WHERE "userId" = 'democoach02') AS sessions FROM "User" WHERE id = 'democoach02'`);
  check(suspended.s && suspended.sessions === 0, "coach suspended and all their sessions deleted");
  await coach.goto(`${APP}/dashboard/coach`);
  check(new URL(coach.url()).pathname === "/login", "the suspended coach is signed out immediately");
  // The coach got a code moments ago; let the 60-second resend cooldown pass.
  await db.query(`UPDATE "EmailCode" SET "createdAt" = now() - interval '2 minutes' WHERE email = 'coach02@demo.nexport.test'`);
  const retry = await (await newContext()).newPage();
  await retry.goto(`${APP}/login`);
  await retry.getByPlaceholder("you@example.com").fill("coach02@demo.nexport.test");
  await retry.getByRole("button", { name: "Continue with email" }).click();
  await retry.waitForURL((u) => u.pathname === "/login/verify");
  await retry.getByLabel("6-digit code").fill(await latestCode("coach02@demo.nexport.test"));
  await retry.getByRole("button", { name: "Continue" }).click();
  await retry.getByText("This account can't sign in").waitFor();
  check(true, "a suspended coach can't sign back in");
  await admin.keyboard.press("Escape");
  await admin.goto(`${APP}/admin/tenants?type=coach`);
  dialog = await openTenantAction(admin, "Tom Becker", "Reactivate tenant");
  await dialog.getByLabel(/Reason/).fill("Review finished, all clear");
  await dialog.getByRole("button", { name: "Reactivate" }).click();
  await dialog.getByText("has been reactivated").waitFor();
  check(!(await one(`SELECT "suspendedAt" FROM "User" WHERE id = 'democoach02'`)).suspendedAt, "reactivation clears the suspension");

  // 5. Plan manager: validation, saving, audit, concurrent edits.
  await admin.goto(`${APP}/admin/subscriptions`);
  await shot(admin, "admin-3-plans");
  const plan = (name) => admin.getByRole("form", { name: `${name} plan` });
  await plan("Club Basic").getByLabel("Available for new sign-ups").check();
  await plan("Club Basic").getByRole("button", { name: "Save changes" }).click();
  await plan("Club Basic").getByText("A paid plan needs a Stripe Price ID").waitFor();
  check(true, "a paid plan can't be activated without a Stripe Price ID");
  await plan("Club Basic").getByLabel("Stripe Price ID").fill("price_1'; DROP TABLE \"User\";--");
  await plan("Club Basic").getByRole("button", { name: "Save changes" }).click();
  await plan("Club Basic").getByText("Stripe Price IDs look like").waitFor();
  check((await one(`SELECT to_regclass('public."User"') IS NOT NULL AS ok`)).ok, "SQL in the Stripe Price ID field is rejected and harmless");

  const pro = plan("Pro Coach");
  await pro.getByLabel(/Monthly price/).fill("34,90");
  await pro.getByLabel(/Platform fee/).fill("4.5");
  await pro.getByLabel("Stripe Price ID").fill("price_1TestProCoach01");
  await pro.getByLabel("Available for new sign-ups").check();
  await pro.getByRole("button", { name: "Save changes" }).click();
  await pro.getByText("Saved.").waitFor();
  const saved = await one(`SELECT "monthlyPriceAmount", "platformFeeBps", "stripePriceId", "isActive", "updatedById" FROM "SubscriptionPlan" WHERE tier = 'PRO_COACH'`);
  check(
    saved.monthlyPriceAmount === 3490 && saved.platformFeeBps === 450 && saved.stripePriceId === "price_1TestProCoach01" && saved.isActive && saved.updatedById === "e2eadmin01",
    "plan saved exactly (€34.90, 4.5%, price id, active, who changed it)",
  );
  const audited = await one(`SELECT details FROM "AdminAuditLog" WHERE action = 'PLAN_UPDATED' AND "targetId" = 'PRO_COACH' ORDER BY "createdAt" DESC LIMIT 1`);
  check(audited?.details?.monthlyPriceAmount?.from === 2900 && audited.details.monthlyPriceAmount.to === 3490, "the audit log records the before/after values");
  await db.query(`UPDATE "SubscriptionPlan" SET "updatedAt" = now() WHERE tier = 'CLUB_ENTERPRISE'`);
  await plan("Club Enterprise").getByLabel("Display name").fill("Club Enterprise+");
  await plan("Club Enterprise").getByRole("button", { name: "Save changes" }).click();
  await plan("Club Enterprise").getByText("Someone else changed this plan").waitFor();
  check((await one(`SELECT name FROM "SubscriptionPlan" WHERE tier = 'CLUB_ENTERPRISE'`)).name === "Club Enterprise", "a concurrent edit is not silently overwritten");

  // 6. Financials and logs.
  await admin.goto(`${APP}/admin/financials`);
  await shot(admin, "admin-4-financials");
  check(await admin.getByText("Needs response").first().isVisible(), "open dispute listed");
  check(await admin.getByRole("region", { name: "Failed transfers" }).getByText("Failed").first().isVisible(), "failed transfer listed");
  check(await admin.getByRole("region", { name: "Connect accounts needing attention" }).getByText("Smash Padel Lisboa").isVisible(), "restricted Connect account flagged");
  check(await admin.getByRole("region", { name: "Platform fee queue" }).getByText("pending").first().isVisible(), "fee queue shows unsettled payouts first");
  await admin.goto(`${APP}/admin/logs?status=failed`);
  check(await admin.getByText("1 event").isVisible() && (await admin.getByText("transfer.failed").isVisible()), "webhook log filters to the failed event");
  await admin.goto(`${APP}/admin/logs?tab=audit`);
  check(await admin.getByText("Tenant suspended").first().isVisible() && (await admin.getByText("Plan updated").first().isVisible()), "audit log lists suspensions and plan edits");

  // 7. Impersonation.
  await admin.goto(`${APP}/admin/tenants?q=ace`);
  dialog = await openTenantAction(admin, "Ace Tennis Academy", "Impersonate");
  await dialog.getByLabel(/Reason/).fill("Support ticket 4821: calendar issue");
  await dialog.getByRole("button", { name: "Start impersonating" }).click();
  await admin.waitForURL((u) => u.pathname === "/dashboard/club");
  await shot(admin, "admin-5-impersonating");
  check(await admin.getByText(/Impersonating .* as admin@e2e-admin\.test/).isVisible(), "impersonation lands on the owner's dashboard with a banner");
  const imp = await one(
    `SELECT s."impersonatorId", s.expires - now() <= interval '1 hour' AS capped FROM "Session" s WHERE s."userId" = 'demoowner02' AND s."impersonatorId" IS NOT NULL`,
  );
  check(imp?.impersonatorId === "e2eadmin01" && imp.capped, "impersonation session is marked and capped at 1 hour");
  check((await admin.goto(`${APP}/admin`)).status() === 404, "the admin area is closed while impersonating");
  await admin.goto(`${APP}/dashboard/settings/security`);
  check(await admin.getByText("can’t be viewed or changed while you are impersonating").isVisible(), "account security is off-limits while impersonating");
  await admin.goto(`${APP}/dashboard/club`);
  await admin.getByRole("button", { name: "Stop impersonating" }).click();
  await admin.waitForURL((u) => u.pathname === "/admin/tenants");
  check(true, "stop impersonating returns to the admin's own session");
  const trail = (await db.query(`SELECT action, "targetId" FROM "AdminAuditLog" WHERE action::text LIKE 'IMPERSONATION%' ORDER BY "createdAt"`)).rows;
  check(trail.length === 2 && trail.every((r) => r.targetId === "democlub02"), "start and end are both audited against the same tenant");
  check(!(await one(`SELECT 1 AS x FROM "Session" WHERE "impersonatorId" IS NOT NULL`)), "the impersonation session is gone");

  // An impersonation session dies the moment its admin is no longer an admin.
  dialog = await openTenantAction(admin, "Ace Tennis Academy", "Impersonate");
  await dialog.getByLabel(/Reason/).fill("Second look at the calendar");
  await dialog.getByRole("button", { name: "Start impersonating" }).click();
  await admin.waitForURL((u) => u.pathname === "/dashboard/club");
  await db.query(`UPDATE "User" SET role = 'STUDENT' WHERE id = 'e2eadmin01'`);
  await admin.goto(`${APP}/dashboard/club`);
  check(new URL(admin.url()).pathname === "/login", "demoting the admin kills their impersonation session at once");
  await db.query(`UPDATE "User" SET role = 'ADMIN' WHERE id = 'e2eadmin01'`);

  // 8. Phone width: the sidebar collapses into a menu and wide tables scroll
  //    inside their panel instead of widening the page.
  //    (A fresh sign-in: the demotion above rightly ended the previous session.)
  await db.query(`UPDATE "EmailCode" SET "createdAt" = now() - interval '2 minutes' WHERE email = $1`, [ADMIN_EMAIL]);
  const phone = await emailSignIn(await newContext(), ADMIN_EMAIL);
  await phone.setViewportSize({ width: 375, height: 812 });
  for (const path of ["/admin", "/admin/tenants", "/admin/subscriptions", "/admin/financials", "/admin/logs"]) {
    await phone.goto(`${APP}${path}`);
    const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const culprits = overflow > 0
      ? await phone.evaluate(() =>
          [...document.querySelectorAll("body *")]
            .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
            .filter((el) => !el.parentElement?.closest(".overflow-x-auto") || getComputedStyle(el).position === "absolute" || getComputedStyle(el).position === "fixed")
            .slice(0, 6)
            .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} pos=${getComputedStyle(el).position} (${Math.round(el.getBoundingClientRect().left)}→${Math.round(el.getBoundingClientRect().right)}px)`),
        )
      : [];
    check(new URL(phone.url()).pathname === path && overflow <= 0, `no horizontal page scroll at 375px on ${path}${culprits.length ? ` [${culprits.join(" | ")}]` : ""}`);
  }
  await phone.getByRole("button", { name: "Menu" }).click();
  await phone.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Tenants & Clubs" }).click();
  await phone.waitForURL((u) => u.pathname === "/admin/tenants");
  check(true, "the mobile admin menu navigates");

  check(consoleErrors.length === 0, `no browser console errors or warnings${consoleErrors.length ? `:\n  ${[...new Set(consoleErrors)].join("\n  ")}` : ""}`);
} catch (error) {
  failures++;
  console.error(error);
  console.error(appLog.split("\n").slice(-30).join("\n"));
} finally {
  if (process.env.E2E_APP_LOG) (await import("node:fs")).writeFileSync(process.env.E2E_APP_LOG, appLog);
  await db.query(`DELETE FROM "Session" WHERE "impersonatorId" = 'e2eadmin01'`);
  await cleanup();
  await db.end();
  await browser.close();
  process.kill(-app.pid, "SIGTERM");
  smtp.close();
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall admin e2e checks passed");
process.exit(failures ? 1 : 0);
