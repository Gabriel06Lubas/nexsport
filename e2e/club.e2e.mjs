// End-to-end test of the club owner / facility manager dashboard: tenant
// isolation and staff permissions, analytics, facilities and dynamic
// pricing, equipment maintenance, court bookings, memberships, staff and
// payroll, billing, suspension and club creation, in a real browser against
// the real app and Postgres with demo data (scripts/seed-demo.mjs).
//
//   DATABASE_URL=postgresql://... npm run test:e2e:club
//
// Signs in with email codes caught by a local SMTP sink. Re-seeds the demo
// data before and after, and deletes the rows it creates elsewhere.
import { spawn, spawnSync } from "node:child_process";

import pg from "pg";
import { chromium } from "playwright";
import { SMTPServer } from "smtp-server";

const APP = "http://localhost:3401";
const DATABASE_URL = process.env.DATABASE_URL?.split("?")[0];
if (!DATABASE_URL) throw new Error("Set DATABASE_URL");
const CLUB = "/dashboard/demo-padel-central";
const NEW_OWNER = "owner@e2e-club.test";

let failures = 0;
function check(condition, message) {
  console.log(`${condition ? "ok  " : "FAIL"} ${message}`);
  if (!condition) failures++;
}
const seed = () => {
  const seeded = spawnSync("node", ["scripts/seed-demo.mjs"], { env: { ...process.env, DATABASE_URL }, encoding: "utf8" });
  if (seeded.status !== 0) throw new Error(`seeding failed:\n${seeded.stderr}`);
};
seed();

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
await new Promise((r) => smtp.listen(2527, "127.0.0.1", r));
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
const app = spawn("npx", ["next", "dev", "-p", "3401"], {
  env: {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: "1",
    DATABASE_URL,
    AUTH_SECRET: "e2e-club-secret-e2e-club-secret-xxxx",
    AUTH_URL: APP,
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: "2527",
    EMAIL_FROM: "nexport <no-reply@e2e-club.test>",
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
  await db.query(`DELETE FROM "Club" WHERE "ownerId" IN (SELECT id FROM "User" WHERE email = $1)`, [NEW_OWNER]);
  await db.query(`DELETE FROM "User" WHERE email = $1`, [NEW_OWNER]);
  await db.query(`DELETE FROM "EmailCode" WHERE email = $1 OR email LIKE '%@demo.nexport.test'`, [NEW_OWNER]);
  await db.query(`UPDATE "SubscriptionPlan" SET "maxFacilities" = NULL WHERE tier = 'CLUB_ENTERPRISE'`);
};
await cleanup();
await db.query(
  `INSERT INTO "User"(id, email, name, role, "emailVerified", "onboardedAt", "updatedAt") VALUES ('e2eclubowner', $1, 'New Owner', 'CLUB_OWNER', now(), now(), now())`,
  [NEW_OWNER],
);

const browser = await chromium.launch();
const consoleErrors = [];
const newContext = async () => {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  // 404s are expected (access checks); anything else is a bug.
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

const status = async (page, path) => (await page.goto(`${APP}${path}`)).status();
const form = (page, name) => page.getByRole("form", { name });
const said = (scope, text) => scope.getByText(text, { exact: false }).first().waitFor({ timeout: 15_000 }).then(() => true, () => false);
const madridDate = async (sqlExpr) => (await one(`SELECT to_char(${sqlExpr}, 'YYYY-MM-DD') AS d`)).d;

try {
  // 1. Tenant isolation and RBAC ------------------------------------------------
  const anon = await (await newContext()).newPage();
  await anon.goto(`${APP}${CLUB}`);
  check(new URL(anon.url()).pathname === "/login", "signed-out club dashboard → /login");

  const athlete = await emailSignIn(await newContext(), "athlete01@demo.nexport.test");
  let leaks = 0;
  for (const path of ["", "/facilities", "/staff", "/memberships", "/schedule", "/billing"]) {
    const code = await status(athlete, `${CLUB}${path}`);
    leaks += code !== 404 || (await athlete.getByText("Facilities & Courts").count()) > 0 ? 1 : 0;
  }
  check(leaks === 0, "a member who is a student of the club gets a plain 404 everywhere (no sidebar)");
  check((await athlete.request.get(`${APP}${CLUB}/staff/payout-report`)).status() === 404, "…and the payout CSV is a 404 too");

  const otherOwner = await emailSignIn(await newContext(), "owner02@demo.nexport.test");
  const landed = (page, path) => page.waitForURL((u) => u.pathname === path, { timeout: 15_000 }).then(() => true, () => false);
  check(await landed(otherOwner, "/dashboard/demo-ace-tennis-academy"), "an owner lands on their own club after sign-in");
  check((await status(otherOwner, CLUB)) === 404, "an owner of another club gets a 404 on Padel Central");
  check((await status(otherOwner, "/dashboard/padel'%20OR%201=1--")) === 404, "a malformed / SQL-ish slug is a 404");

  const staff = await emailSignIn(await newContext(), "staff01@demo.nexport.test");
  await staff.goto(`${APP}${CLUB}`);
  const staffNav = staff.getByRole("navigation", { name: "Club" });
  check(
    (await staffNav.getByRole("link", { name: "Bookings & Schedule" }).isVisible()) &&
      (await staffNav.getByRole("link", { name: "Billing & Stripe Connect" }).count()) === 0 &&
      (await staffNav.getByRole("link", { name: "Facilities & Courts" }).count()) === 0,
    "front-desk staff see only the sections their permissions open",
  );
  check(await staff.getByText("Your role doesn't include analytics").isVisible(), "staff without analytics get a welcome page instead of KPIs");
  check((await status(staff, `${CLUB}/billing`)) === 404 && (await status(staff, `${CLUB}/facilities`)) === 404, "staff get a 404 on sections they can't open");
  check((await staff.request.get(`${APP}${CLUB}/staff/payout-report`)).status() === 404, "staff without billing can't download the payout report");
  await staff.goto(`${APP}${CLUB}/staff`);
  check(
    (await staff.getByRole("columnheader", { name: "Pay terms" }).count()) === 0 && (await staff.getByText("€14.00/h").count()) === 0,
    "staff without billing don't see anyone's wages",
  );
  check(
    (await form(staff, "Add to the roster").getByRole("option", { name: "Staff (dashboard access)" }).count()) === 0 &&
      (await form(staff, "Add to the roster").getByLabel("Commission (%)").count()) === 0,
    "staff can't add dashboard users or set pay terms",
  );

  // 2. Overview -------------------------------------------------------------------
  const owner = await emailSignIn(await newContext(), "owner01@demo.nexport.test");
  check(await landed(owner, CLUB), "the owner lands on their club's overview");
  const kpi = (label) => owner.getByRole("region", { name: label }).innerText();
  check(/\d+(\.\d)?%/.test(await kpi("Court utilisation, last 30 days")), "utilisation KPI shows a rate with booked / open hours");
  const { revenue } = await one(`
    SELECT (COALESCE((SELECT sum(tr.amount - tr."reversedAmount") FROM "PaymentTransaction" pt JOIN "PaymentTransfer" tr ON tr."paymentId" = pt.id
                       AND tr."recipientType" = 'CLUB' AND tr.status IN ('PENDING','PAID')
                      WHERE pt."clubId" = 'democlub01' AND pt.status = 'SUCCEEDED'
                        AND pt."paidAt" >= date_trunc('month', now() AT TIME ZONE 'Europe/Madrid') AT TIME ZONE 'Europe/Madrid'), 0)
          + COALESCE((SELECT sum("priceAmount") FROM "FacilityBooking" WHERE "clubId" = 'democlub01' AND "paymentMethod" = 'ON_SITE' AND status = 'CONFIRMED'
                        AND "paidAt" >= date_trunc('month', now() AT TIME ZONE 'Europe/Madrid') AT TIME ZONE 'Europe/Madrid'), 0)
          + COALESCE((SELECT sum("priceAmount") FROM "MemberPass" WHERE "clubId" = 'democlub01' AND "paymentMethod" = 'ON_SITE'
                        AND "paidAt" >= date_trunc('month', now() AT TIME ZONE 'Europe/Madrid') AT TIME ZONE 'Europe/Madrid'), 0))::int AS revenue`);
  const euros = (cents) => new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(cents / 100);
  check((await kpi("Revenue this month")).includes(euros(revenue)), `revenue this month = ${euros(revenue)} (Connect transfers to the club + desk payments)`);
  check((await kpi("Active members")).includes("6"), "6 active members");
  check(/\n4\n/.test(await kpi("Pass holders")), "4 pass holders (expired, used-up and cancelled passes excluded)");
  await owner.getByRole("region", { name: "Monthly revenue breakdown" }).getByText("Show as table").click();
  check(await owner.getByRole("region", { name: "Monthly revenue breakdown" }).getByRole("columnheader", { name: "Coaching commissions" }).isVisible(), "revenue chart has a legend and a table view");
  check(await owner.getByRole("region", { name: "Peak hours, last 4 weeks" }).getByText("Busiest:").isVisible(), "occupancy heatmap names the busiest slot");

  // 3. Facilities, pricing, equipment ------------------------------------------
  await owner.goto(`${APP}${CLUB}/facilities`);
  await db.query(`UPDATE "SubscriptionPlan" SET "maxFacilities" = 7 WHERE tier = 'CLUB_ENTERPRISE'`);
  const addFacility = form(owner, "Add a facility");
  await addFacility.getByLabel("Name").fill("E2E Turf Pitch");
  await addFacility.getByLabel("Type").selectOption("FOOTBALL_PITCH");
  await addFacility.getByLabel("Standard rate per hour (EUR)").fill("40");
  await addFacility.getByLabel("Opens").fill("09:00");
  await addFacility.getByLabel("Closes").fill("21:00");
  await addFacility.getByRole("button", { name: "Add facility" }).click();
  check(await said(owner, "Facility added."), "a new pitch is added");
  const pitch = owner.getByRole("region", { name: "E2E Turf Pitch" });
  check(await pitch.getByText("09:00–21:00").isVisible(), "…with its opening hours");

  await addFacility.getByLabel("Name").fill("Another pitch");
  await addFacility.getByRole("button", { name: "Add facility" }).click();
  check(await said(addFacility, "plan includes 7 active facilities"), "the plan's facility limit is enforced");
  await db.query(`UPDATE "SubscriptionPlan" SET "maxFacilities" = NULL WHERE tier = 'CLUB_ENTERPRISE'`);
  await addFacility.getByLabel("Name").fill(`Court ${String.fromCharCode(0x202e)}1`);
  await addFacility.getByRole("button", { name: "Add facility" }).click();
  check(await said(addFacility, "contains characters that aren't allowed"), "a bidi-override name is rejected");
  await addFacility.getByLabel("Name").fill("E2E Turf Pitch");
  await addFacility.getByRole("button", { name: "Add facility" }).click();
  check(await said(addFacility, "You already have a facility with that name"), "duplicate facility names are rejected");

  await pitch.getByText("Add a price window").click();
  const windowForm = form(owner, "Add a price window to E2E Turf Pitch");
  for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri"]) await windowForm.getByLabel(day, { exact: true }).check();
  await windowForm.getByLabel("From").fill("18:00");
  await windowForm.getByLabel("Until").fill("21:00");
  await windowForm.getByLabel("Rate per hour (EUR)").fill("60");
  await windowForm.getByRole("button", { name: "Add window" }).click();
  check(await said(pitch, "Mon–Fri · 18:00–21:00 · €60.00/h"), "a peak window for Mon–Fri is added and shown as one rule");
  await windowForm.getByLabel("Mon", { exact: true }).check();
  await windowForm.getByLabel("From").fill("19:00");
  await windowForm.getByLabel("Until").fill("20:00");
  await windowForm.getByLabel("Rate per hour (EUR)").fill("70");
  await windowForm.getByRole("button", { name: "Add window" }).click();
  check(await said(windowForm, "overlaps an existing price rule"), "an overlapping window is refused by the database guard");
  check((await one(`SELECT count(*)::int AS n FROM "FacilityPriceRule" r JOIN "Facility" f ON f.id = r."facilityId" WHERE f.name = 'E2E Turf Pitch'`)).n === 5, "…and nothing partial was saved (5 rows, one per weekday)");

  const rackets = owner.getByRole("row").filter({ hasText: "Rental padel rackets" });
  await rackets.getByText("Manage").click();
  const repair = form(owner, "Send Rental padel rackets to maintenance");
  await repair.getByLabel("Units").fill("22");
  await repair.getByLabel("Reason").fill("Storm damage");
  await repair.getByRole("button", { name: "Log maintenance" }).click();
  check(await said(repair, "more units than are left in service"), "can't send more units to repair than are in service (24 owned, 3 already in repair)");
  await repair.getByLabel("Units").fill("2");
  await repair.getByLabel("Reason").fill("Loose grips");
  await repair.getByRole("button", { name: "Log maintenance" }).click();
  check(await said(owner, "Those units can't be booked"), "2 rackets logged for maintenance");
  check((await rackets.innerText()).includes("19"), "available rackets drop to 19 (24 − 5 in repair)");
  const openRepair = owner.getByRole("region", { name: /Under maintenance/ }).getByRole("listitem").filter({ hasText: "Loose grips" });
  await openRepair.getByRole("button", { name: "Back in service" }).click();
  await openRepair.waitFor({ state: "detached", timeout: 15_000 }).catch(() => {});
  check(
    (await one(`SELECT "resolvedAt" IS NOT NULL AND "resolvedById" = 'demoowner01' AS ok FROM "EquipmentMaintenance" WHERE reason = 'Loose grips'`)).ok &&
      (await owner.getByRole("region", { name: "Recently repaired" }).getByText("Loose grips").isVisible()),
    "a repaired item goes back into service (moved to the repaired log)",
  );

  // 4. Bookings & schedule ---------------------------------------------------------
  const monday = await madridDate(`(now() AT TIME ZONE 'Europe/Madrid')::date + (8 - extract(isodow FROM now() AT TIME ZONE 'Europe/Madrid'))::int + 7`);
  await owner.goto(`${APP}${CLUB}/schedule?date=${monday}`);
  const book = form(owner, "New court booking");
  const fillBooking = async (facility, from, until, name) => {
    await book.getByLabel("Facility").selectOption({ label: facility });
    await book.getByLabel("Date").fill(monday);
    await book.getByLabel("From").fill(from);
    await book.getByLabel("Until").fill(until);
    await book.getByLabel("Or walk-in name").fill(name);
    await book.getByRole("button", { name: "Book" }).click();
  };
  await fillBooking("E2E Turf Pitch", "17:00", "18:30", "E2E Walk-in");
  check(await said(book, "Booked E2E Turf Pitch, 17:00–18:30 · €70.00."), "price is computed from dynamic pricing: 1 h standard €40 + 30 min peak €60/h = €70");
  check((await one(`SELECT "priceAmount" FROM "FacilityBooking" WHERE "customerName" = 'E2E Walk-in'`)).priceAmount === 7000, "…and stored in cents (7000)");
  await fillBooking("E2E Turf Pitch", "18:00", "19:00", "E2E Double");
  check(await said(book, "already rented at that time"), "double-booking the pitch is refused");
  await fillBooking("E2E Turf Pitch", "07:00", "08:00", "E2E Early");
  check(await said(book, "is open 09:00–21:00"), "bookings outside opening hours are refused");

  const clinic = await one(`
    SELECT to_char(s."startsAt" AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD') AS day, to_char(s."startsAt" AT TIME ZONE 'Europe/Madrid', 'HH24:MI') AS "from",
           to_char(s."endsAt" AT TIME ZONE 'Europe/Madrid', 'HH24:MI') AS until, f.name AS facility
      FROM "PracticeSession" s JOIN "Facility" f ON f.id = s."facilityId"
     WHERE s."clubId" = 'democlub01' AND s.status = 'SCHEDULED' AND s."startsAt" > now() + interval '2 hours' ORDER BY s."startsAt" LIMIT 1`);
  await book.getByLabel("Facility").selectOption({ label: clinic.facility });
  await book.getByLabel("Date").fill(clinic.day);
  await book.getByLabel("From").fill(clinic.from);
  await book.getByLabel("Until").fill(clinic.until);
  await book.getByLabel("Or walk-in name").fill("E2E Clash");
  await book.getByRole("button", { name: "Book" }).click();
  check(await said(book, "clashes with a coached session"), "a rental over a coached clinic is refused (cross-table guard)");

  await book.getByLabel("Customer email").fill("nobody@nowhere.test");
  await book.getByLabel("Or walk-in name").fill("");
  await book.getByRole("button", { name: "Book" }).click();
  check(await said(book, "No nexport account uses that email"), "unknown customer emails are explained");

  const row = owner.getByRole("region", { name: "E2E Turf Pitch" }).getByRole("listitem").filter({ hasText: "E2E Walk-in" });
  await row.getByText("Cancel", { exact: true }).click();
  await row.getByLabel("Reason").fill("Customer called");
  await row.getByRole("button", { name: "Cancel booking" }).click();
  check(await said(row, "Cancelled"), "a desk booking is cancelled");
  check((await one(`SELECT status FROM "FacilityBooking" WHERE "customerName" = 'E2E Walk-in'`)).status === "CANCELLED", "…and the slot is freed in the database");

  // 5. Memberships ------------------------------------------------------------------
  await owner.goto(`${APP}${CLUB}/memberships`);
  const newPlan = form(owner, "Create a plan");
  await newPlan.getByLabel("Name").fill("E2E 5-Pack");
  await newPlan.getByLabel("Type").selectOption("CREDITS");
  await newPlan.getByLabel("Price (EUR)").fill("45");
  await newPlan.getByLabel("Valid for (days)").fill("60");
  await newPlan.getByRole("button", { name: "Create plan" }).click();
  check(await said(newPlan, "Session passes need a number of sessions"), "a session pass without credits is rejected");
  await newPlan.getByLabel("Sessions included").fill("5");
  await newPlan.getByRole("button", { name: "Create plan" }).click();
  check(await said(owner, "Plan created."), "a 5-session pass plan is created");

  const sell = form(owner, "Sell a pass");
  await sell.getByLabel("Plan").selectOption({ label: "E2E 5-Pack · €45.00" });
  await sell.getByLabel("Member email").fill("stranger@nowhere.test");
  await sell.getByRole("button", { name: "Sell pass" }).click();
  check(await said(sell, "Ask the member to sign up first"), "selling to an unknown email is explained");
  await sell.getByLabel("Member email").fill("athlete01@demo.nexport.test");
  await sell.getByRole("button", { name: "Sell pass" }).click();
  check(await said(sell, "E2E 5-Pack sold to athlete01@demo.nexport.test."), "a pass is sold at the desk");
  await owner.goto(`${APP}${CLUB}/memberships?filter=active&q=athlete01`);
  const passRow = owner.getByRole("row").filter({ hasText: "E2E 5-Pack" });
  check((await passRow.innerText()).includes("5 of 5"), "the new pass shows 5 of 5 credits");
  await passRow.getByRole("button", { name: "Use 1 credit" }).click();
  check(await said(passRow, "Credit used: 4 of 5 left."), "using a credit decrements it atomically");
  check((await status(owner, `${CLUB}/memberships?filter=%27;DROP&page=-4&q=%25`)) === 200, "hostile filter / page / search params are ignored");

  // 6. Staff, permissions and payroll ---------------------------------------------
  await owner.goto(`${APP}${CLUB}/staff`);
  const roster = form(owner, "Add to the roster");
  await roster.getByLabel("Email").fill("coach03@demo.nexport.test");
  await roster.getByLabel("Commission (%)").fill("60");
  await roster.getByRole("button", { name: "Add" }).click();
  check(await said(roster, "Coach added to the roster."), "a freelance coach is added with a 60% commission");
  await owner.goto(`${APP}${CLUB}/staff`);
  const nora = owner.getByRole("row").filter({ hasText: "staff01@demo.nexport.test" });
  await nora.getByText("Manage").click();
  const perms = form(owner, "Permissions for Nora Front Desk");
  await perms.getByLabel("Analytics").check();
  await perms.getByRole("button", { name: "Save permissions" }).click();
  check(await said(perms, "Permissions saved."), "the owner grants analytics to front-desk staff");
  await staff.goto(`${APP}${CLUB}`);
  check(await staff.getByRole("region", { name: "Court utilisation, last 30 days" }).isVisible(), "…who sees the KPIs on their next page load");

  const month = (await one(`SELECT to_char(now() AT TIME ZONE 'Europe/Madrid', 'YYYY-MM') AS m`)).m;
  const csv = await owner.request.get(`${APP}${CLUB}/staff/payout-report?month=${month}`);
  const body = await csv.text();
  check(
    csv.status() === 200 && csv.headers()["content-type"].startsWith("text/csv") && body.startsWith("Name,Email,Role") && body.includes("Lucía Romero"),
    "the payout report downloads as CSV with each coach's Connect split",
  );
  check((await owner.request.get(`${APP}${CLUB}/staff/payout-report?month=2026-13`)).status() === 404, "an invalid report month is a 404");

  // 7. Billing ----------------------------------------------------------------------
  await owner.goto(`${APP}${CLUB}/billing`);
  check(await owner.getByText("Charges enabled:").isVisible() && (await owner.getByText("Nothing outstanding").isVisible()), "Connect card shows charges / payouts enabled");
  await owner.getByRole("link", { name: "Memberships", exact: true }).click();
  await owner.waitForURL((u) => u.searchParams.get("kind") === "MEMBERSHIP");
  check(await said(owner, "Transaction history (2)"), "transactions filter to the 2 online membership payments");
  check(await owner.getByText("Membership · Monthly Unlimited").isVisible(), "…labelled with the plan they paid for");

  // 8. Suspension: read-only, enforced on the server too ---------------------------
  await owner.goto(`${APP}${CLUB}/schedule?date=${monday}`);
  await db.query(`UPDATE "Club" SET status = 'SUSPENDED' WHERE id = 'democlub01'`);
  await fillBooking("E2E Turf Pitch", "10:00", "11:00", "E2E Suspended");
  check(await said(book, "This club is suspended by nexport"), "a form opened before suspension is refused by the server");
  await owner.reload();
  check((await owner.getByRole("alert").filter({ hasText: "suspended by nexport" }).isVisible()) && (await form(owner, "New court booking").count()) === 0, "suspended clubs show a banner and no forms");
  await db.query(`UPDATE "Club" SET status = 'ACTIVE' WHERE id = 'democlub01'`);

  // 9. A new owner creates a club ----------------------------------------------------
  const newOwner = await emailSignIn(await newContext(), NEW_OWNER);
  check(new URL(newOwner.url()).pathname === "/dashboard/club" && (await newOwner.getByRole("heading", { name: "Create your club" }).isVisible()), "an owner without a club is asked to create one");
  const create = form(newOwner, "Create a club");
  await create.getByLabel("Club name").fill("E2E Club");
  await create.getByLabel("Dashboard address").fill("settings");
  await create.getByRole("button", { name: "Create club" }).click();
  check(await said(create, "That address is reserved"), "reserved slugs (static routes) are refused");
  await create.getByLabel("Dashboard address").fill("demo-padel-central");
  await create.getByRole("button", { name: "Create club" }).click();
  check(await said(create, "That address is taken"), "taken slugs are refused");
  await create.getByLabel("Dashboard address").fill("e2e-club");
  await create.getByRole("button", { name: "Create club" }).click();
  await newOwner.waitForURL((u) => u.pathname === "/dashboard/e2e-club");
  check(await newOwner.getByText("Setting up").first().isVisible(), "the new club opens in set-up mode, owned by its creator");

  // 10. Phone width ------------------------------------------------------------------
  await db.query(`UPDATE "EmailCode" SET "createdAt" = now() - interval '2 minutes' WHERE email = 'owner01@demo.nexport.test'`);
  const phone = await emailSignIn(await newContext(), "owner01@demo.nexport.test");
  await phone.setViewportSize({ width: 375, height: 812 });
  for (const path of ["", "/facilities", "/staff", "/memberships", "/schedule", "/billing"]) {
    await phone.goto(`${APP}${CLUB}${path}`);
    const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(new URL(phone.url()).pathname === `${CLUB}${path}` && overflow <= 0, `no horizontal page scroll at 375px on ${CLUB}${path}`);
  }
  await phone.getByRole("button", { name: "Menu" }).click();
  await phone.getByRole("navigation", { name: "Club" }).getByRole("link", { name: "Facilities & Courts" }).click();
  await phone.waitForURL((u) => u.pathname === `${CLUB}/facilities`);
  check(true, "the mobile club menu navigates");

  check(consoleErrors.length === 0, `no browser console errors or warnings${consoleErrors.length ? `:\n  ${[...new Set(consoleErrors)].join("\n  ")}` : ""}`);
} catch (error) {
  failures++;
  console.error(error);
  console.error(appLog.split("\n").slice(-30).join("\n"));
} finally {
  if (process.env.E2E_APP_LOG) (await import("node:fs")).writeFileSync(process.env.E2E_APP_LOG, appLog);
  await db.query(`UPDATE "Club" SET status = 'ACTIVE' WHERE id = 'democlub01'`);
  await cleanup();
  await db.end();
  await browser.close();
  process.kill(-app.pid, "SIGTERM");
  smtp.close();
  seed();
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall club e2e checks passed");
process.exit(failures ? 1 : 0);
