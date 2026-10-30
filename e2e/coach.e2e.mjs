// End-to-end test of the coach dashboard: role gate, KPIs against the
// database, the new-session modal with court / coach / equipment checks,
// cancelling and completing sessions, attendance, credit adjustments, the
// booking link and availability, public self-booking (including two students
// racing for one slot), earnings, and phone layout.
//
//   DATABASE_URL=postgresql://... npm run test:e2e:coach
//
// Re-seeds the demo data before and after.
import { spawn, spawnSync } from "node:child_process";

import pg from "pg";
import { chromium } from "playwright";
import { SMTPServer } from "smtp-server";

const APP = "http://localhost:3402";
const DATABASE_URL = process.env.DATABASE_URL?.split("?")[0];
if (!DATABASE_URL) throw new Error("Set DATABASE_URL");
const COACH = "/dashboard/coach";

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
await new Promise((r) => smtp.listen(2528, "127.0.0.1", r));
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
const app = spawn("npx", ["next", "dev", "-p", "3402"], {
  env: {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: "1",
    DATABASE_URL,
    AUTH_SECRET: "e2e-coach-secret-e2e-coach-secret-xx",
    AUTH_URL: APP,
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: "2528",
    EMAIL_FROM: "nexport <no-reply@e2e-coach.test>",
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
  await db.query(`DELETE FROM "EmailCode" WHERE email LIKE '%@demo.nexport.test'`);
};
await cleanup();
// A court only this test uses, so availability checks are deterministic.
await db.query(
  `INSERT INTO "Facility"(id, "clubId", name, type, "openMinute", "closeMinute", "hourlyRateAmount", "updatedAt")
   VALUES ('e2efaccoach', 'democlub01', 'E2E Court', 'PADEL_COURT', 540, 1260, 2400, now())`,
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
  const euros = (cents) => new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(cents / 100);
  const landed = (page, path) => page.waitForURL((u) => u.pathname === path, { timeout: 15_000 }).then(() => true, () => false);
  const nextMonday = await madridDate(`(now() AT TIME ZONE 'Europe/Madrid')::date + (8 - extract(isodow FROM now() AT TIME ZONE 'Europe/Madrid'))::int + 7`);

  // 1. Who gets in -----------------------------------------------------------------
  const anon = await (await newContext()).newPage();
  await anon.goto(`${APP}${COACH}`);
  check(new URL(anon.url()).pathname === "/login", "signed-out /dashboard/coach → /login");
  check((await status(anon, "/coach/nobody-here")) === 404, "an unknown booking link is a 404");
  await anon.goto(`${APP}/coach/lucia-romero`);
  check(
    (await anon.getByRole("heading", { name: "Lucía Romero" }).isVisible()) && (await anon.getByRole("link", { name: "Sign in" }).count()) > 1,
    "the public booking page is open to everyone, with sign-in to book",
  );

  const athlete = await emailSignIn(await newContext(), "athlete01@demo.nexport.test");
  await athlete.goto(`${APP}${COACH}/earnings`);
  check(await landed(athlete, "/dashboard/athlete"), "a student is sent to their own home, not the coach area");
  const owner = await emailSignIn(await newContext(), "owner01@demo.nexport.test");
  await owner.goto(`${APP}${COACH}`);
  check(await landed(owner, "/dashboard/demo-padel-central"), "a club owner is sent to their club");

  // 2. Overview ------------------------------------------------------------------------
  const coach = await emailSignIn(await newContext(), "coach01@demo.nexport.test");
  check(await landed(coach, COACH), "the coach lands on Schedule & Sessions");
  const kpi = (label) => coach.getByRole("region", { name: label }).innerText();
  const { pending } = await one(`
    SELECT COALESCE(sum(tr.amount), 0)::int AS pending FROM "PaymentTransfer" tr JOIN "StripeAccount" sa ON sa.id = tr."stripeAccountId"
     WHERE sa."userId" = 'democoach01' AND tr."recipientType" = 'COACH' AND tr.status = 'PENDING'`);
  check((await kpi("Pending session earnings")).includes(euros(pending)), `pending earnings = ${euros(pending)} (pending Connect transfers)`);
  const att = await one(`
    SELECT count(*)::int AS marked, count(*) FILTER (WHERE a.status IN ('PRESENT','LATE'))::int AS attended
      FROM "Attendance" a JOIN "PracticeSession" s ON s.id = a."sessionId"
     WHERE s."coachId" = 'democoach01' AND s.status <> 'CANCELLED' AND s."startsAt" > now() - interval '90 days'`);
  check((await kpi("Average attendance rate")).includes(`${Math.round((att.attended / att.marked) * 100)}%`), `attendance rate = ${att.attended}/${att.marked}`);
  check(/h this week/.test(await kpi("Hours scheduled")), "hours scheduled this week and month");
  await coach.goto(`${APP}${COACH}?week=${nextMonday}`);
  check(await coach.getByRole("region", { name: /^Week of/ }).getByText("Private lesson").first().isVisible(), "the week timeline shows upcoming private lessons");

  // 3. New-session modal: court, coach and equipment checks ---------------------------
  await coach.getByRole("button", { name: "New session" }).click();
  const modal = form(coach, "New session");
  const schedule = async ({ kind = "GROUP", title, facility, from, until, max = "", student = "", equipment = "None", units = "" }) => {
    await modal.getByLabel("Type").selectOption(kind);
    await modal.getByLabel("Title").fill(title);
    await modal.getByLabel("Club · facility").selectOption({ label: facility });
    await modal.getByLabel("Date").fill(nextMonday);
    await modal.getByLabel("From").fill(from);
    await modal.getByLabel("Until").fill(until);
    await modal.getByLabel("Max students").fill(max);
    await modal.getByLabel("Add a student (email)").fill(student);
    await modal.getByLabel("Reserve equipment").selectOption({ label: equipment });
    await modal.getByLabel("Units").fill(units);
    await modal.getByRole("button", { name: "Schedule" }).click();
  };
  await schedule({ title: "E2E Footwork", facility: "Padel Central · Padel Glass Court 1", from: "13:00", until: "14:00", max: "4" });
  check(await said(modal, "Scheduled “E2E Footwork”"), "a group session is scheduled from the modal");
  await schedule({ title: "E2E Clash", facility: "Padel Central · E2E Court", from: "13:30", until: "14:30" });
  check(await said(modal, "You already have a session at that time."), "the coach can't be double-booked, even on another court");
  await db.query(
    `INSERT INTO "FacilityBooking"(id, "clubId", "facilityId", "customerName", "startsAt", "endsAt", "priceAmount", "paymentMethod", "updatedAt")
     VALUES ('e2erentalcoach', 'democlub01', 'e2efaccoach', 'E2E renter', ($1::date + time '15:00') AT TIME ZONE 'Europe/Madrid', ($1::date + time '16:00') AT TIME ZONE 'Europe/Madrid', 2400, 'ON_SITE', now())`,
    [nextMonday],
  );
  await schedule({ title: "E2E Rented", facility: "Padel Central · E2E Court", from: "15:30", until: "16:30" });
  check(await said(modal, "clashes with a coached session or another booking"), "a court already rented is refused");
  await schedule({ title: "E2E Late", facility: "Padel Central · E2E Court", from: "21:00", until: "22:00" });
  check(await said(modal, "is open 09:00–21:00"), "sessions outside the court's opening hours are refused");
  await schedule({ title: "E2E Rackets", facility: "Padel Central · E2E Court", from: "17:00", until: "18:00", equipment: "Padel Central · Rental padel rackets (24)", units: "22" });
  check(await said(modal, "Not enough of that equipment is free"), "equipment over-allocation is refused (24 rackets, 3 in repair)");
  check((await one(`SELECT count(*)::int AS n FROM "PracticeSession" WHERE title = 'E2E Rackets'`)).n === 0, "…and the session isn't half-created");
  await schedule({ title: "E2E Rackets", facility: "Padel Central · E2E Court", from: "17:00", until: "18:00", equipment: "Padel Central · Rental padel rackets (24)", units: "4" });
  check(await said(modal, "Scheduled “E2E Rackets”"), "a session with 4 rackets reserved is scheduled");
  await schedule({ kind: "PRIVATE", title: "E2E Private", facility: "Padel Central · E2E Court", from: "18:00", until: "19:00", student: "athlete06@demo.nexport.test" });
  check(await said(modal, "Scheduled “E2E Private”"), "a private session with a student is scheduled");
  const created = await one(`
    SELECT (SELECT count(*)::int FROM "EquipmentBooking" eb JOIN "PracticeSession" s ON s.id = eb."sessionId" WHERE s.title = 'E2E Rackets' AND eb.quantity = 4) AS eq,
           (SELECT count(*)::int FROM "SessionParticipant" p JOIN "PracticeSession" s ON s.id = p."sessionId" WHERE s.title = 'E2E Private' AND s.kind = 'PRIVATE' AND p."userId" = 'demoathlete06') AS student,
           (SELECT "coachShareBps" FROM "PracticeSession" WHERE title = 'E2E Footwork') AS share`);
  check(created.eq === 1 && created.student === 1 && created.share === 7000, "equipment reserved, student added, and the coach's 70% commission copied from the roster");
  await coach.getByRole("button", { name: "Close" }).click();

  // 4. Cancel, complete -------------------------------------------------------------
  await coach.reload();
  const racketsRow = coach.locator("li[id^='session-']").filter({ hasText: "E2E Rackets" });
  await racketsRow.getByText("Cancel", { exact: true }).click();
  await racketsRow.getByLabel("Reason").fill("Court maintenance");
  await racketsRow.getByRole("button", { name: "Cancel session" }).click();
  await racketsRow.waitFor({ state: "detached", timeout: 15_000 }).catch(() => {});
  const cancelled = await one(`
    SELECT s.status, eb.status AS equipment FROM "PracticeSession" s JOIN "EquipmentBooking" eb ON eb."sessionId" = s.id WHERE s.title = 'E2E Rackets'`);
  check(cancelled.status === "CANCELLED" && cancelled.equipment === "CANCELLED", "cancelling a session releases its reserved equipment");

  const wrap = coach.getByRole("region", { name: /^To wrap up/ });
  const wrapId = (await one(`SELECT id FROM "PracticeSession" WHERE "coachId" = 'democoach01' AND status = 'SCHEDULED' AND "startsAt" < now() ORDER BY "startsAt" DESC LIMIT 1`)).id;
  await wrap.getByRole("button", { name: "Mark completed" }).first().click();
  await coach.waitForTimeout(500);
  for (let i = 0; i < 30 && (await one(`SELECT status FROM "PracticeSession" WHERE id = $1`, [wrapId])).status !== "COMPLETED"; i++) await coach.waitForTimeout(300);
  check((await one(`SELECT status FROM "PracticeSession" WHERE id = $1`, [wrapId])).status === "COMPLETED", "a past session is marked completed");

  // 5. Attendance and credits ------------------------------------------------------------
  await coach.goto(`${APP}${COACH}/students`);
  const participant = await one(`SELECT p.id, COALESCE(u.name, u.email) AS name FROM "SessionParticipant" p JOIN "User" u ON u.id = p."userId" WHERE p."sessionId" = $1`, [wrapId]);
  const sheetRow = coach.getByRole("list", { name: /^Attendance for/ }).getByRole("listitem").filter({ hasText: participant.name }).first();
  await sheetRow.getByRole("button", { name: "Late" }).click();
  check(await said(sheetRow, "Marked late."), "a student is checked in as late");
  check((await one(`SELECT status, "markedById" FROM "Attendance" WHERE "participantId" = $1`, [participant.id])).status === "LATE", "…saved with who marked it");

  const passRow = coach.getByRole("row").filter({ hasText: "athlete02@demo.nexport.test" }).filter({ hasText: "10-Session Punch Card" });
  const before = (await one(`SELECT "creditsUsed" FROM "MemberPass" WHERE id = 'demopass2'`)).creditsUsed;
  await passRow.getByRole("button", { name: "−1 session" }).click();
  check(await said(passRow, `${10 - before - 1} of 10 left.`), "a coach deducts a session from a student's punch card");
  await passRow.getByRole("button", { name: "+1 back" }).click();
  check(await said(passRow, `${10 - before} of 10 left.`), "…and gives it back");
  const ledger = await one(`SELECT count(*)::int AS n, sum(delta)::int AS net FROM "PassCreditAdjustment" WHERE "passId" = 'demopass2' AND "actorId" = 'democoach01'`);
  check(ledger.n === 2 && ledger.net === 0, "both changes are in the credit ledger, attributed to the coach");
  check((await coach.getByRole("row").filter({ hasText: "athlete05@demo.nexport.test" }).getByRole("button", { name: "−1 session" }).count()) === 0, "a used-up card offers no deduction");
  check((await status(coach, `${COACH}/students?q=%25'%20OR%201=1--`)) === 200 && (await coach.getByText("No students match.").isVisible()), "hostile directory searches are inert");

  // 6. Booking link and availability ----------------------------------------------------
  await coach.goto(`${APP}${COACH}/availability`);
  const settings = form(coach, "Booking page settings");
  await settings.getByLabel("Your link").fill("admin");
  await settings.getByRole("button", { name: "Save" }).click();
  check(await said(settings, "That link is reserved"), "reserved booking links are refused");
  await settings.getByLabel("Your link").fill("Lucia-E2E");
  await settings.getByLabel(/^Private rate per hour/).fill("");
  await settings.getByRole("button", { name: "Save" }).click();
  check(await said(settings, "Set a private rate before opening bookings"), "booking can't be switched on without a price");
  await settings.getByLabel(/^Private rate per hour/).fill("45");
  await settings.getByRole("button", { name: "Save" }).click();
  check(await said(settings, "Your booking page is live."), "the link is changed (and lower-cased)");
  check((await status(anon, "/coach/lucia-e2e")) === 200 && (await status(anon, "/coach/lucia-romero")) === 404, "the new link works and the old one is gone");
  const someoneElses = (await one(`SELECT id FROM "PracticeSession" WHERE "coachId" = 'democoach01' AND kind = 'PRIVATE' AND "startsAt" > now() LIMIT 1`)).id;
  await anon.goto(`${APP}/coach/lucia-e2e?booked=${someoneElses}`);
  check((await anon.getByText("You're booked").count()) === 0, "a booking confirmation link shows nothing to anyone but the student");

  await coach.getByText("Add working hours").click();
  const hoursForm = form(coach, "Add working hours");
  await hoursForm.getByLabel("Sun", { exact: true }).check();
  await hoursForm.getByLabel("From").fill("10:00");
  await hoursForm.getByLabel("Until").fill("12:00");
  await hoursForm.getByRole("button", { name: "Add hours" }).click();
  check(await said(coach, "Sun · 10:00–12:00"), "a Sunday window is added");
  await hoursForm.getByLabel("Sun", { exact: true }).check();
  await hoursForm.getByLabel("From").fill("11:00");
  await hoursForm.getByLabel("Until").fill("13:00");
  await hoursForm.getByRole("button", { name: "Add hours" }).click();
  check(await said(hoursForm, "overlaps one of your availability windows"), "overlapping windows are refused");

  // 7. Public self-booking -----------------------------------------------------------
  const student = await emailSignIn(await newContext(), "athlete06@demo.nexport.test");
  await student.goto(`${APP}/coach/lucia-e2e`);
  check(await student.getByText("€45.00 · 60 min").isVisible(), "the public page shows the new rate");
  const slotButtons = student.getByRole("button", { name: "Book", exact: true });
  for (let i = 1; i <= 3; i++) {
    await slotButtons.first().click();
    check(await said(student, "You're booked with Lucía Romero."), `a student books slot ${i} and sees the confirmation`);
  }
  await slotButtons.first().click();
  check(await said(student, "You already have 3 upcoming sessions"), "a student can hold at most 3 upcoming self-booked sessions with a coach");
  const booked = await one(`
    SELECT count(*)::int AS n, min(s."priceAmount")::int AS price FROM "PracticeSession" s JOIN "SessionParticipant" p ON p."sessionId" = s.id
     WHERE s."coachId" = 'democoach01' AND s.kind = 'PRIVATE' AND p."userId" = 'demoathlete06' AND s."createdById" = 'demoathlete06'`);
  check(booked.n === 3 && booked.price === 4500, "3 private sessions created at €45.00, owned by the student who booked");

  const [a4, a5] = await Promise.all([emailSignIn(await newContext(), "athlete04@demo.nexport.test"), emailSignIn(await newContext(), "athlete05@demo.nexport.test")]);
  await Promise.all([a4.goto(`${APP}/coach/lucia-e2e`), a5.goto(`${APP}/coach/lucia-e2e`)]);
  const slotText = await a4.getByRole("button", { name: "Book", exact: true }).first().locator("xpath=ancestor::li[1]").innerText();
  await Promise.all([a4.getByRole("button", { name: "Book", exact: true }).first().click(), a5.getByRole("button", { name: "Book", exact: true }).first().click()]);
  const [r4, r5] = await Promise.all([said(a4, "You're booked"), said(a5, "You're booked")]);
  const lost = (await a4.getByText("Someone booked that slot").count()) + (await a5.getByText("Someone booked that slot").count()) + (await a4.getByText("just taken").count()) + (await a5.getByText("just taken").count());
  check(Number(r4) + Number(r5) === 1 && lost === 1, `two students racing for ${slotText.split("\n")[0]}: exactly one gets it`);

  const own = await coach.goto(`${APP}/coach/lucia-e2e`).then(() => coach);
  check((await own.getByText("This is your booking page").isVisible()) && (await own.getByRole("button", { name: "Book", exact: true }).count()) === 0, "the coach sees their own page without booking buttons");

  // 8. Earnings ------------------------------------------------------------------------
  await coach.goto(`${APP}${COACH}/earnings`);
  const { txs } = await one(`SELECT count(*)::int AS txs FROM "PaymentTransaction" pt JOIN "PracticeSession" s ON s.id = pt."sessionId" WHERE s."coachId" = 'democoach01' AND pt.status = 'SUCCEEDED'`);
  check(await coach.getByText(`Transaction history (${txs})`).isVisible(), `transaction history lists all ${txs} paid seats`);
  check((await coach.getByText("Charges enabled:").isVisible()) && (await coach.getByRole("rowheader", { name: /Direct private sessions/ }).isVisible()), "Connect status and the breakdown by stream are shown");

  // 9. Phone width -------------------------------------------------------------------
  await db.query(`UPDATE "EmailCode" SET "createdAt" = now() - interval '2 minutes' WHERE email = 'coach01@demo.nexport.test'`);
  const phone = await emailSignIn(await newContext(), "coach01@demo.nexport.test");
  await phone.setViewportSize({ width: 375, height: 812 });
  for (const path of [COACH, `${COACH}/students`, `${COACH}/availability`, `${COACH}/earnings`, "/coach/lucia-e2e"]) {
    await phone.goto(`${APP}${path}`);
    const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(new URL(phone.url()).pathname === path && overflow <= 0, `no horizontal page scroll at 375px on ${path}`);
  }
  await phone.goto(`${APP}${COACH}`);
  await phone.getByRole("button", { name: "Menu" }).click();
  await phone.getByRole("navigation", { name: "Coach" }).getByRole("link", { name: "Earnings & Stripe" }).click();
  check(await landed(phone, `${COACH}/earnings`), "the mobile coach menu navigates");

  check(consoleErrors.length === 0, `no browser console errors or warnings${consoleErrors.length ? `:\n  ${[...new Set(consoleErrors)].join("\n  ")}` : ""}`);
} catch (error) {
  failures++;
  console.error(error);
  console.error(appLog.split("\n").slice(-30).join("\n"));
} finally {
  if (process.env.E2E_APP_LOG) (await import("node:fs")).writeFileSync(process.env.E2E_APP_LOG, appLog);
  await cleanup();
  await db.end();
  await browser.close();
  process.kill(-app.pid, "SIGTERM");
  smtp.close();
  seed();
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall coach e2e checks passed");
process.exit(failures ? 1 : 0);
