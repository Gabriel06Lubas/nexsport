// End-to-end test of the student dashboard: role gate, KPIs, the schedule
// feed, cancellation refunds by policy (through Stripe), bookings and passes,
// the open-match board with level matching, Stripe Checkout for a seat
// (paid, abandoned, expired, raced for, and paid after release), webhook
// signature checks, saved cards and the customer portal, levels and match
// alerts, and the phone layout with its tab bar.
//
//   DATABASE_URL=postgresql://... npm run test:e2e:student
//
// Runs against a local mock of the Stripe API (no network). Re-seeds the
// demo data before and after.
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";

import pg from "pg";
import { chromium } from "playwright";
import { SMTPServer } from "smtp-server";
import Stripe from "stripe";

const APP = "http://localhost:3403";
const DATABASE_URL = process.env.DATABASE_URL?.split("?")[0];
if (!DATABASE_URL) throw new Error("Set DATABASE_URL");
const HOME = "/dashboard/student";

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
await new Promise((r) => smtp.listen(2529, "127.0.0.1", r));
async function latestCode(address) {
  for (let i = 0; i < 100; i++) {
    const mails = inbox.filter((m) => m.to.includes(address));
    const subject = mails.at(-1)?.raw.match(/^Subject: (\d{3}) (\d{3}) is your nexport code/m);
    if (subject) return subject[1] + subject[2];
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`no code for ${address}`);
}

// --- Mock Stripe ---------------------------------------------------------------
// Answers the API calls the Stripe SDK makes, serves a checkout page, and
// sends webhooks signed exactly like Stripe's to the app.
const STRIPE = "http://127.0.0.1:12111";
const WEBHOOK_SECRET = "whsec_e2e_student";
const signer = new Stripe("sk_test_e2e");
const stripeCalls = [];
const checkouts = new Map();
let seq = 0;
let lastWebhook = null;
async function sendWebhook(type, object) {
  const payload = JSON.stringify({ id: `evt_e2e_${++seq}`, object: "event", type, livemode: false, created: Math.floor(Date.now() / 1000), api_version: "2026-09-30.endive", data: { object } });
  const header = signer.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const res = await fetch(`${APP}/api/stripe/webhook`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": header }, body: payload });
  lastWebhook = { payload, header };
  return { status: res.status, payload, header };
}
const stripeServer = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const form = new URLSearchParams(body);
  const url = new URL(req.url, STRIPE);
  const json = (status, data) => (res.writeHead(status, { "content-type": "application/json", "request-id": `req_${++seq}` }), res.end(JSON.stringify(data)));
  const html = (markup) => (res.writeHead(200, { "content-type": "text/html; charset=utf-8" }), res.end(`<!doctype html><title>Mock Stripe</title>${markup}`));
  stripeCalls.push({ method: req.method, path: url.pathname, form: Object.fromEntries(form) });
  const m = url.pathname.match(/^\/pay\/(cs_e2e_\d+)(\/(complete|back))?$/);
  if (m) {
    const cs = checkouts.get(m[1]);
    if (!m[2]) return html(`<h1>Pay ${cs.amount / 100} ${cs.currency}</h1><form method="post" action="/pay/${cs.id}/complete"><button>Pay</button></form><form method="post" action="/pay/${cs.id}/back"><button>Back</button></form>`);
    if (m[3] === "back") return (res.writeHead(303, { location: cs.cancel_url }), res.end());
    cs.paid = true;
    await sendWebhook("checkout.session.completed", { id: cs.id, object: "checkout.session", payment_status: "paid", status: "complete", payment_intent: `pi_e2e_${cs.id}`, metadata: { paymentId: cs.paymentId }, client_reference_id: cs.paymentId });
    return (res.writeHead(303, { location: cs.success_url }), res.end());
  }
  if (url.pathname === "/portal") return html("<h1>Mock customer portal</h1>");
  if (req.method === "POST" && url.pathname === "/v1/customers") return json(200, { id: `cus_e2e_${++seq}`, object: "customer", email: form.get("email") });
  if (req.method === "POST" && url.pathname === "/v1/checkout/sessions") {
    const id = `cs_e2e_${++seq}`;
    const cs = {
      id,
      paymentId: form.get("metadata[paymentId]"),
      amount: Number(form.get("line_items[0][price_data][unit_amount]")),
      currency: form.get("line_items[0][price_data][currency]"),
      success_url: form.get("success_url"),
      cancel_url: form.get("cancel_url"),
    };
    checkouts.set(id, cs);
    return json(200, { id, object: "checkout.session", url: `${STRIPE}/pay/${id}`, status: "open" });
  }
  const expire = url.pathname.match(/^\/v1\/checkout\/sessions\/(cs_e2e_\d+)\/expire$/);
  if (req.method === "POST" && expire) {
    const cs = checkouts.get(expire[1]);
    cs.expired = true;
    setTimeout(() => sendWebhook("checkout.session.expired", { id: cs.id, object: "checkout.session", payment_status: "unpaid", status: "expired", metadata: { paymentId: cs.paymentId } }), 50);
    return json(200, { id: cs.id, object: "checkout.session", status: "expired" });
  }
  if (req.method === "POST" && url.pathname === "/v1/refunds") return json(200, { id: `re_e2e_${++seq}`, object: "refund", amount: Number(form.get("amount")), payment_intent: form.get("payment_intent"), status: "succeeded" });
  if (req.method === "GET" && /^\/v1\/customers\/[^/]+\/payment_methods$/.test(url.pathname)) {
    return json(200, { object: "list", url: url.pathname, has_more: false, data: [{ id: "pm_e2e_visa", object: "payment_method", type: "card", card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030 } }] });
  }
  if (req.method === "POST" && url.pathname === "/v1/billing_portal/sessions") return json(200, { id: "bps_e2e", object: "billing_portal.session", url: `${STRIPE}/portal` });
  json(404, { error: { type: "invalid_request_error", message: `mock: no route ${req.method} ${url.pathname}` } });
});
await new Promise((r) => stripeServer.listen(12111, "127.0.0.1", r));

// --- App -----------------------------------------------------------------------
const app = spawn("npx", ["next", "dev", "-p", "3403"], {
  env: {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: "1",
    DATABASE_URL,
    AUTH_SECRET: "e2e-student-secret-e2e-student-secr",
    AUTH_URL: APP,
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: "2529",
    EMAIL_FROM: "nexport <no-reply@e2e-student.test>",
    STRIPE_SECRET_KEY: "sk_test_e2e",
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    STRIPE_API_BASE: STRIPE,
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
  await db.query(`DELETE FROM "StripeWebhookEvent" WHERE id LIKE 'evt_e2e_%'`);
  await db.query(`UPDATE "User" SET "stripeCustomerId" = NULL WHERE "stripeCustomerId" LIKE 'cus_e2e_%'`);
};
await cleanup();
// A court only this test uses, so availability checks are deterministic.
await db.query(
  `INSERT INTO "Facility"(id, "clubId", name, type, "openMinute", "closeMinute", "hourlyRateAmount", "updatedAt")
   VALUES ('e2efacstudent', 'democlub01', 'E2E Court', 'PADEL_COURT', 420, 1380, 2400, now())`,
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
  page.on("dialog", (d) => d.accept());
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
  const landed = (page, path) => page.waitForURL((u) => u.pathname === path, { timeout: 15_000 }).then(() => true, () => false);
  const euros = (cents) => new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(cents / 100);
  const dayLabel = (d) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Madrid" }).format(new Date(d));
  const timeLabel = (d) => new Intl.DateTimeFormat("en-GB", { timeStyle: "short", timeZone: "Europe/Madrid" }).format(new Date(d));
  const waitFor = async (fn, ms = 15_000) => {
    for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 200))) if (await fn()) return true;
    return false;
  };

  // 1. Who gets in ----------------------------------------------------------------
  const anon = await (await newContext()).newPage();
  await anon.goto(`${APP}${HOME}`);
  check(new URL(anon.url()).pathname === "/login", "signed-out /dashboard/student → /login");
  const coachPage = await emailSignIn(await newContext(), "coach01@demo.nexport.test");
  await coachPage.goto(`${APP}${HOME}/bookings`);
  check(await landed(coachPage, "/dashboard/coach"), "a coach is sent to the coach dashboard");

  // 2. Overview KPIs ----------------------------------------------------------------
  const a2 = await emailSignIn(await newContext(), "athlete02@demo.nexport.test");
  check(await landed(a2, HOME), "a student lands on Overview & Upcoming");
  const kpi = (page, label) => page.getByRole("region", { name: label }).innerText();
  check((await kpi(a2, "Session passes")).includes("6/10 sessions left"), "the punch card shows 6/10 sessions left");
  check((await kpi(a2, "Memberships")).includes("Padel Central"), "the club membership badge is shown");
  await a2.goto(`${APP}/dashboard/athlete`);
  check(await landed(a2, HOME), "the old /dashboard/athlete link redirects here");

  // 3. Cancelling with the refund policy -------------------------------------------
  const rental = async (id, startsIn, method, amount) => {
    await db.query(
      `INSERT INTO "FacilityBooking"(id, "clubId", "facilityId", "customerId", "startsAt", "endsAt", "priceAmount", "paymentMethod", "paidAt", "updatedAt")
       VALUES ($1, 'democlub01', 'e2efacstudent', 'demoathlete01', $2::timestamptz, $2::timestamptz + interval '1 hour', $3, $4, $5, now())`,
      [id, startsIn, amount, method, method === "ONLINE" ? new Date() : null],
    );
    if (method === "ONLINE") {
      await db.query(
        `INSERT INTO "PaymentTransaction"(id, "clubId", kind, "facilityBookingId", "payerId", amount, currency, "applicationFeeAmount", status, "stripePaymentIntentId",
           "transferGroup", "idempotencyKey", "paidAt", "updatedAt")
         VALUES ($1, 'democlub01', 'COURT_RENTAL', $2, 'demoathlete01', $3, 'eur', 144, 'SUCCEEDED', $4, $1, $1, now(), now())`,
        [`pay${id}`, id, amount, `pi_${id}`],
      );
    }
    return (await one(`SELECT "startsAt" FROM "FacilityBooking" WHERE id = $1`, [id])).startsAt;
  };
  const at = async (expr) => (await one(`SELECT (${expr}) AS t`)).t;
  const madridDay = (days, hour) => at(`(date_trunc('day', now() AT TIME ZONE 'Europe/Madrid') + interval '${days} days ${hour} hours') AT TIME ZONE 'Europe/Madrid'`);
  const free = await rental("e2erentfree", await madridDay(3, 20), "ON_SITE", 2400);
  const full = await rental("e2erentfull", await madridDay(4, 21), "ONLINE", 4800);
  const half = await rental("e2erenthalf", await at(`date_trunc('minute', now()) + interval '10 hours'`), "ONLINE", 4800);

  const a1 = await emailSignIn(await newContext(), "athlete01@demo.nexport.test");
  const card = (page, startsAt) => page.getByRole("article").filter({ hasText: "E2E Court" }).filter({ hasText: `${dayLabel(startsAt)} · ${timeLabel(startsAt)}–` });
  const directions = await card(a1, free).getByRole("link", { name: "Get directions" }).getAttribute("href");
  check(directions?.startsWith("https://www.google.com/maps/search/") && directions.includes("Padel%20Central"), "Get directions opens the club's address in Maps");
  check((await card(a1, free).innerText()).includes("Nothing paid yet: free to cancel."), "an unpaid booking says it's free to cancel");
  check(/Cancel now: 100% back \(€48\.00\) for \d+ d \d+ h more, then 50%/.test(await card(a1, full).innerText()), "a paid booking 4 days out shows 100% back and a countdown to 50%");
  check((await card(a1, half).innerText()).includes("Cancel now: 50% back (€24.00)"), "a paid booking 10 hours out shows 50% back");

  await card(a1, free).getByRole("button", { name: "Cancel booking" }).click();
  check(await said(a1, "Cancelled."), "the unpaid rental is cancelled");
  await card(a1, full).getByRole("button", { name: "Cancel booking" }).click();
  check(await said(a1, "€48.00 (100%) is on its way back to your card."), "cancelling 4 days out refunds 100% through Stripe");
  await card(a1, half).getByRole("button", { name: "Cancel booking" }).click();
  check(await said(a1, "€24.00 (50%) is on its way back to your card."), "cancelling 10 hours out refunds 50%");
  const refunds = stripeCalls.filter((c) => c.path === "/v1/refunds").map((c) => `${c.form.payment_intent}:${c.form.amount}`);
  const rows3 = (await db.query(`SELECT b.id, b.status, b."cancelledById", pt."refundStatus", pt."refundedAmount", pt."appliedRefundPercent", pt."cancellationPolicyId"
                                   FROM "FacilityBooking" b LEFT JOIN "PaymentTransaction" pt ON pt."facilityBookingId" = b.id WHERE b.id LIKE 'e2erent%' ORDER BY b.id`)).rows;
  check(
    rows3.every((r) => r.status === "CANCELLED" && r.cancelledById === "demoathlete01") &&
      refunds.includes("pi_e2erentfull:4800") &&
      refunds.includes("pi_e2erenthalf:2400") &&
      rows3.find((r) => r.id === "e2erenthalf").refundStatus === "PARTIALLY_REFUNDED" &&
      rows3.find((r) => r.id === "e2erenthalf").cancellationPolicyId === "demopolicy01",
    "refunds sent to Stripe for the right amounts, saved with the policy that applied",
  );

  // 4. Bookings & passes ---------------------------------------------------------------
  await a1.goto(`${APP}${HOME}/bookings`);
  check(await a1.getByRole("list", { name: "Refund rules at Padel Central" }).getByText("24 h+ before: 100%").isVisible(), "the club's cancellation rules are listed");
  await a1.getByRole("link", { name: "Past", exact: true }).click();
  check(await said(a1, "Completed"), "past bookings are listed as completed");
  check(await a1.getByRole("listitem", { name: "Monthly Unlimited at Padel Central" }).getByText("Active").isVisible(), "the active membership pass is shown with its purchase");

  // 5. Open matches and Stripe Checkout ---------------------------------------------
  const levelMatches = (await db.query(`SELECT id, "startsAt" FROM "PracticeSession" WHERE id LIKE 'demoopen%' AND "minLevel" = 3.0 ORDER BY "startsAt"`)).rows;
  const [m1, m2, m3] = levelMatches;
  const matchCard = (page, m) => page.getByRole("listitem", { name: `Level 3.0–4.0 Padel, ${dayLabel(m.startsAt)}` });
  const a6 = await emailSignIn(await newContext(), "athlete06@demo.nexport.test");
  await a6.goto(`${APP}${HOME}/open-matches`);
  const high = (await one(`SELECT count(*)::int AS n FROM "PracticeSession" WHERE id LIKE 'demoopen%' AND "minLevel" = 5.0`)).n;
  check(high > 0 && (await a6.getByText("Level 5.0–6.0").count()) === 0, "matches outside the player's level (3.5) are hidden by default");
  check((await matchCard(a6, m1).innerText()).includes("2/4 slots filled"), "a match shows 2/4 slots filled");

  await matchCard(a6, m1).getByRole("button", { name: "Join & pay €9.00" }).click();
  await a6.waitForURL((u) => u.href.startsWith(STRIPE), { timeout: 15_000 });
  check(true, "joining a paid match opens Stripe Checkout for the €9.00 share");
  await a6.getByRole("button", { name: "Pay" }).click();
  check(await said(a6, "Payment received (€9.00). You're confirmed."), "after paying, the student is back with a confirmation");
  const paid = await one(`
    SELECT pt.status, pt."stripePaymentIntentId", pt."applicationFeeAmount", p.status AS seat,
           (SELECT json_agg(json_build_object('type', "recipientType", 'amount', amount, 'status', status) ORDER BY "recipientType") FROM "PaymentTransfer" WHERE "paymentId" = pt.id) AS transfers
      FROM "PaymentTransaction" pt JOIN "SessionParticipant" p ON p.id = pt."participantId"
     WHERE pt."sessionId" = $1 AND pt."payerId" = 'demoathlete06'`, [m1.id]);
  const split = (paid?.transfers ?? []).reduce((n, t) => n + t.amount, 0);
  check(
    paid?.status === "SUCCEEDED" && paid.seat === "ACCEPTED" && paid.stripePaymentIntentId?.startsWith("pi_e2e_") && paid.transfers?.length === 2 && split === 900 - paid.applicationFeeAmount,
    `the webhook settles the seat and queues the club and coach transfers (${JSON.stringify(paid?.transfers)})`,
  );

  // Abandoned checkout: the seat is held, then released.
  await a6.goto(`${APP}${HOME}/open-matches`);
  await matchCard(a6, m2).getByRole("button", { name: "Join & pay €9.00" }).click();
  await a6.waitForURL((u) => u.href.startsWith(STRIPE), { timeout: 15_000 });
  const abandoned = [...checkouts.values()].at(-1);
  await a6.getByRole("button", { name: "Back" }).click();
  check(await said(a6, "Payment not completed."), "leaving checkout brings the student back with a note");
  const pending = a6.getByRole("article").filter({ hasText: "Lunchtime open match" }).filter({ hasText: "Pending" });
  check((await pending.getByRole("button", { name: "Pay now" }).isVisible()) && (await pending.innerText()).includes("spot held for"), "the held seat shows Pending, the hold countdown and Pay now");
  await pending.getByRole("button", { name: "Release spot" }).click();
  check(await said(a6, "Spot released. You weren't charged."), "the student releases the held seat");
  const released = await one(`SELECT pt.status, p.status AS seat FROM "PaymentTransaction" pt JOIN "SessionParticipant" p ON p.id = pt."participantId" WHERE pt."stripeCheckoutSessionId" = $1`, [abandoned.id]);
  check(released.status === "CANCELED" && released.seat === "CANCELLED" && stripeCalls.some((c) => c.path === `/v1/checkout/sessions/${abandoned.id}/expire`), "…and the Checkout Session is expired at Stripe");

  // Paid anyway after release (a race with Stripe): refunded automatically.
  await fetch(`${STRIPE}/pay/${abandoned.id}/complete`, { method: "POST", redirect: "manual" });
  check(
    await waitFor(async () => (await one(`SELECT "refundStatus" FROM "PaymentTransaction" WHERE "stripeCheckoutSessionId" = $1`, [abandoned.id])).refundStatus === "REFUNDED"),
    "a payment that completes after the seat was released is refunded in full",
  );

  // Hold expiry without any webhook.
  await a6.goto(`${APP}${HOME}/open-matches`);
  await matchCard(a6, m3).getByRole("button", { name: "Join & pay €9.00" }).click();
  await a6.waitForURL((u) => u.href.startsWith(STRIPE), { timeout: 15_000 });
  await db.query(`UPDATE "PaymentTransaction" SET "checkoutExpiresAt" = now() - interval '1 minute' WHERE "sessionId" = $1 AND status = 'REQUIRES_PAYMENT_METHOD'`, [m3.id]);
  await a6.goto(`${APP}${HOME}/open-matches`);
  check((await matchCard(a6, m3).innerText()).includes("2/4 slots filled"), "an expired hold frees the seat even if Stripe's webhook never comes");

  // Two players, one seat left.
  await db.query(`INSERT INTO "SessionParticipant"(id, "sessionId", "userId", status, "updatedAt") VALUES ('e2eseat3', $1, 'demoathlete05', 'ACCEPTED', now())`, [m3.id]);
  await Promise.all([a1.goto(`${APP}${HOME}/open-matches`), a6.goto(`${APP}${HOME}/open-matches`)]);
  await Promise.all([matchCard(a1, m3).getByRole("button", { name: "Join & pay €9.00" }).click(), matchCard(a6, m3).getByRole("button", { name: "Join & pay €9.00" }).click()]);
  const [w1, w6] = await Promise.all([a1, a6].map((page) => page.waitForURL((u) => u.href.startsWith(STRIPE), { timeout: 10_000 }).then(() => true, () => false)));
  const filled = (await a1.getByText("This match just filled up.").count()) + (await a6.getByText("This match just filled up.").count());
  check(Number(w1) + Number(w6) === 1 && filled === 1, "two players racing for the last seat: one goes to checkout, the other is told it filled up");
  check((await one(`SELECT count(*)::int AS n FROM "SessionParticipant" WHERE "sessionId" = $1 AND status = 'ACCEPTED'`, [m3.id])).n === 4, "…and the match holds exactly 4 players");

  const a4 = await emailSignIn(await newContext(), "athlete04@demo.nexport.test");
  await a4.goto(`${APP}${HOME}/open-matches?fit=all`);
  check((await matchCard(a4, m2).getByText("Not your level").isVisible()) && (await matchCard(a4, m2).getByRole("button").count()) === 0, "a 2.5 player sees a 3.0–4.0 match marked 'Not your level', without a join button");

  // Webhook security.
  const forged = await fetch(`${APP}/api/stripe/webhook`, { method: "POST", headers: { "stripe-signature": "t=1,v1=deadbeef" }, body: lastWebhook.payload });
  const replay = await fetch(`${APP}/api/stripe/webhook`, { method: "POST", headers: { "stripe-signature": lastWebhook.header }, body: lastWebhook.payload });
  check(forged.status === 400 && replay.status === 200 && (await replay.json()).duplicate === true, "forged webhook signatures are rejected; replayed events are acknowledged once and ignored");

  // 6. Settings, cards and the customer portal --------------------------------------
  await a6.goto(`${APP}${HOME}/settings`);
  check(await a6.getByRole("list", { name: "Saved cards" }).getByText("•••• 4242").isVisible(), "saved cards come from the student's Stripe customer");
  check((await a6.getByRole("table").innerText()).includes("Lunchtime open match"), "billing history lists the seat payments");
  const levelsForm = form(a6, "Playing level");
  await levelsForm.getByLabel("Padel").fill("11");
  await levelsForm.getByRole("button", { name: "Save levels" }).click();
  check(await said(levelsForm, "Use a level from 0 to 10"), "an out-of-range level is rejected");
  await levelsForm.getByLabel("Padel").fill("3,5");
  await levelsForm.getByRole("button", { name: "Save levels" }).click();
  check(await said(levelsForm, "Levels saved."), "a level written with a comma is saved");
  const prefs = form(a6, "Clubs and notifications");
  await prefs.getByLabel("Match alerts").uncheck();
  await prefs.getByRole("button", { name: "Save preferences" }).click();
  check(await said(prefs, "Preferences saved."), "match alerts are switched off");
  await a6.getByRole("button", { name: "Manage payment methods" }).click();
  await a6.waitForURL((u) => u.href === `${STRIPE}/portal`, { timeout: 15_000 });
  check(await a6.getByRole("heading", { name: "Mock customer portal" }).isVisible(), "Manage payment methods opens the Stripe customer portal");

  // 7. Match alerts ------------------------------------------------------------------
  const nextMonday = await madridDate(`(now() AT TIME ZONE 'Europe/Madrid')::date + (8 - extract(isodow FROM now() AT TIME ZONE 'Europe/Madrid'))::int + 7`);
  await coachPage.goto(`${APP}/dashboard/coach`);
  await coachPage.getByRole("button", { name: "New session" }).click();
  const modal = form(coachPage, "New session");
  await modal.getByLabel("Type").selectOption("OPEN_MATCH");
  await modal.getByLabel("Title").fill("E2E Alert match");
  await modal.getByLabel("Club · facility").selectOption({ label: "Padel Central · E2E Court" });
  await modal.getByLabel("Sport").selectOption({ label: "Padel" });
  await modal.getByLabel("Date").fill(nextMonday);
  await modal.getByLabel(/^From/).fill("10:00");
  await modal.getByLabel(/^Until/).fill("11:00");
  await modal.getByLabel("Level from").fill("3");
  await modal.getByLabel("Level to").fill("4");
  await modal.getByRole("button", { name: "Schedule" }).click();
  check(await said(modal, "Scheduled “E2E Alert match”"), "a coach posts a level 3.0–4.0 open match");
  const posted = await one(`SELECT "priceAmount", "minLevel"::float8 AS min, "maxLevel"::float8 AS max FROM "PracticeSession" WHERE title = 'E2E Alert match'`);
  check(posted.priceAmount === 600 && posted.min === 3 && posted.max === 4, "with no price set, each player's share is the court price split 4 ways (€24 ÷ 4 = €6)");
  const alerted = (address) => inbox.some((m) => m.to.includes(address) && /Subject: (=\?UTF-8\?Q\?)?Open[ _]padel[ _]match[ _]at[ _]Padel[ _]Central/i.test(m.raw));
  check(
    await waitFor(async () => alerted("athlete01@demo.nexport.test") && alerted("athlete03@demo.nexport.test")),
    `players at level 3.5 and 4.0 who prefer the club get a match alert${alerted("athlete01@demo.nexport.test") ? "" : ` [got: ${inbox.filter((m) => !/is your nexport code/.test(m.raw)).map((m) => `${m.to} ${m.raw.match(/^Subject:.*$/m)?.[0]}`).join(" | ")}]`}`,
  );
  check(!alerted("athlete06@demo.nexport.test") && !alerted("athlete05@demo.nexport.test") && !alerted("athlete04@demo.nexport.test"), "no alert for alerts switched off, or levels 5.0 and 2.5");

  // 8. Phone layout ------------------------------------------------------------------
  await db.query(`UPDATE "EmailCode" SET "createdAt" = now() - interval '2 minutes' WHERE email = 'athlete01@demo.nexport.test'`);
  const phone = await emailSignIn(await newContext(), "athlete01@demo.nexport.test");
  await phone.setViewportSize({ width: 375, height: 812 });
  for (const path of [HOME, `${HOME}/bookings`, `${HOME}/open-matches`, `${HOME}/settings`]) {
    await phone.goto(`${APP}${path}`);
    const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(new URL(phone.url()).pathname === path && overflow <= 0, `no horizontal page scroll at 375px on ${path}`);
  }
  await phone.goto(`${APP}${HOME}`);
  await phone.getByRole("navigation", { name: "Student (tabs)" }).getByRole("link", { name: "Matches" }).click();
  check(await landed(phone, `${HOME}/open-matches`), "the bottom tab bar navigates on phones");

  check(consoleErrors.length === 0, `no browser console errors or warnings${consoleErrors.length ? `:\n  ${[...new Set(consoleErrors)].join("\n  ")}` : ""}`);
} catch (error) {
  failures++;
  console.error(error);
  console.error(appLog.split("\n").slice(-40).join("\n"));
} finally {
  if (process.env.E2E_APP_LOG) (await import("node:fs")).writeFileSync(process.env.E2E_APP_LOG, appLog);
  await cleanup();
  await db.end();
  await browser.close();
  process.kill(-app.pid, "SIGTERM");
  smtp.close();
  stripeServer.close();
  seed();
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall student e2e checks passed");
process.exit(failures ? 1 : 0);
