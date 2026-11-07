// End-to-end test of paid onboarding and plan enforcement: signing up as a
// club owner (role and club exist only after Stripe confirms payment),
// cancelling, tampering with the plan, a subscription for the wrong Price,
// webhook replays, a forged webhook, PAST_DUE lockout and recovery, the Club
// Basic court limit, the Free Coach 15-student cap and the Pro Coach upgrade.
//
//   DATABASE_URL=postgresql://... npm run test:e2e:onboarding
//
// Runs against a local mock of the Stripe API (no network). Re-seeds the
// demo data before and after.
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";

import pg from "pg";
import { chromium } from "playwright";
import { SMTPServer } from "smtp-server";
import Stripe from "stripe";

const APP = "http://localhost:3404";
const DATABASE_URL = process.env.DATABASE_URL?.split("?")[0];
if (!DATABASE_URL) throw new Error("Set DATABASE_URL");
const OWNER = "owner@onb.test";
const COACH = "coach@onb.test";
const PRICES = { CLUB_BASIC: ["price_onbBasic0001", 9900], CLUB_ENTERPRISE: ["price_onbEnterprise01", 29900], PRO_COACH: ["price_onbProCoach01", 2900] };

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
await new Promise((r) => smtp.listen(2530, "127.0.0.1", r));
async function latestCode(address) {
  for (let i = 0; i < 100; i++) {
    const subject = inbox.filter((m) => m.to.includes(address)).at(-1)?.raw.match(/^Subject: (\d{3}) (\d{3}) is your nexport code/m);
    if (subject) return subject[1] + subject[2];
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`no code for ${address}`);
}

// --- Mock Stripe ---------------------------------------------------------------
// Checkout in subscription mode, subscriptions, customers and the billing
// portal; webhooks are signed exactly like Stripe's.
const STRIPE = "http://127.0.0.1:12112";
const WEBHOOK_SECRET = "whsec_e2e_onboarding";
const signer = new Stripe("sk_test_e2e");
const checkouts = new Map();
const subscriptions = new Map();
const amountOf = Object.fromEntries(Object.values(PRICES));
let seq = 0;
async function sendWebhook(type, object, id = `evt_onb_${++seq}`) {
  const payload = JSON.stringify({ id, object: "event", type, livemode: false, created: Math.floor(Date.now() / 1000), api_version: "2026-09-30.endive", data: { object } });
  const header = signer.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const res = await fetch(`${APP}/api/webhooks/stripe`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": header }, body: payload });
  return { status: res.status, id, payload, header };
}
const sessionEvent = (cs) => ({
  id: cs.id,
  object: "checkout.session",
  mode: "subscription",
  status: "complete",
  payment_status: "paid",
  customer: cs.customer,
  subscription: cs.subscription,
  client_reference_id: cs.client_reference_id,
  metadata: cs.metadata,
});
function subscriptionObject(id, customer, priceId, status = "active") {
  const now = Math.floor(Date.now() / 1000);
  return {
    id,
    object: "subscription",
    status,
    customer,
    start_date: now,
    cancel_at_period_end: false,
    canceled_at: null,
    trial_end: null,
    items: { object: "list", data: [{ id: `si_${id}`, object: "subscription_item", current_period_start: now, current_period_end: now + 30 * 86400, price: { id: priceId, object: "price", unit_amount: amountOf[priceId] ?? 0, currency: "usd" } }] },
  };
}
const webhooks = [];
const stripeServer = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const form = new URLSearchParams(body);
  const url = new URL(req.url, STRIPE);
  const json = (status, data) => (res.writeHead(status, { "content-type": "application/json", "request-id": `req_${++seq}` }), res.end(JSON.stringify(data)));
  const html = (markup) => (res.writeHead(200, { "content-type": "text/html; charset=utf-8" }), res.end(`<!doctype html><title>Mock Stripe</title>${markup}`));

  const pay = url.pathname.match(/^\/pay\/(cs_onb_\d+)(\/(complete|wrong-price|back))?$/);
  if (pay) {
    const cs = checkouts.get(pay[1]);
    if (!pay[2]) {
      return html(
        `<h1>Subscribe for ${amountOf[cs.price] / 100} USD/month</h1>` +
          `<form method="post" action="/pay/${cs.id}/complete"><button>Subscribe</button></form>` +
          `<form method="post" action="/pay/${cs.id}/wrong-price"><button>Subscribe to a cheaper price</button></form>` +
          `<form method="post" action="/pay/${cs.id}/back"><button>Back</button></form>`,
      );
    }
    if (pay[3] === "back") return (res.writeHead(303, { location: cs.cancel_url }), res.end());
    // "wrong-price": a subscription that exists and is paid, but for Club Basic.
    const price = pay[3] === "wrong-price" ? PRICES.CLUB_BASIC[0] : cs.price;
    const sub = subscriptionObject(`sub_onb_${++seq}`, cs.customer, price);
    subscriptions.set(sub.id, sub);
    cs.subscription = sub.id;
    // The webhook lands a moment after the customer is back on the site.
    setTimeout(async () => webhooks.push(await sendWebhook("checkout.session.completed", sessionEvent(cs))), 1500);
    return (res.writeHead(303, { location: cs.success_url }), res.end());
  }
  if (url.pathname === "/portal") return html("<h1>Mock billing portal</h1>");
  if (req.method === "POST" && url.pathname === "/v1/customers") return json(200, { id: `cus_onb_${++seq}`, object: "customer", email: form.get("email") });
  if (req.method === "POST" && url.pathname === "/v1/checkout/sessions") {
    const id = `cs_onb_${++seq}`;
    const cs = {
      id,
      mode: form.get("mode"),
      customer: form.get("customer"),
      price: form.get("line_items[0][price]"),
      client_reference_id: form.get("client_reference_id"),
      metadata: { planCheckoutId: form.get("metadata[planCheckoutId]"), tier: form.get("metadata[tier]") },
      success_url: form.get("success_url"),
      cancel_url: form.get("cancel_url"),
    };
    checkouts.set(id, cs);
    return json(200, { id, object: "checkout.session", url: `${STRIPE}/pay/${id}`, status: "open", mode: cs.mode });
  }
  const sub = url.pathname.match(/^\/v1\/subscriptions\/(sub_onb_\d+)$/);
  if (req.method === "GET" && sub && subscriptions.has(sub[1])) return json(200, subscriptions.get(sub[1]));
  if (req.method === "POST" && url.pathname === "/v1/billing_portal/sessions" && !form.get("customer")?.startsWith("cus_onb_")) {
    // Like Stripe for a customer that isn't in this account (e.g. seeded demo ids).
    return json(400, { error: { type: "invalid_request_error", code: "resource_missing", param: "customer", message: `No such customer: '${form.get("customer")}'` } });
  }
  if (req.method === "POST" && url.pathname === "/v1/billing_portal/sessions") return json(200, { id: "bps_onb", object: "billing_portal.session", url: `${STRIPE}/portal` });
  json(404, { error: { type: "invalid_request_error", message: `mock: no route ${req.method} ${url.pathname}` } });
});
await new Promise((r) => stripeServer.listen(12112, "127.0.0.1", r));

// --- App -----------------------------------------------------------------------
const app = spawn("npx", ["next", "dev", "-p", "3404"], {
  env: {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: "1",
    DATABASE_URL,
    AUTH_SECRET: "e2e-onboarding-secret-e2e-onboarding",
    AUTH_URL: APP,
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: "2530",
    EMAIL_FROM: "nexport <no-reply@e2e-onboarding.test>",
    STRIPE_SECRET_KEY: "sk_test_e2e",
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    STRIPE_API_BASE: STRIPE,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_e2e",
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
  await db.query(`DELETE FROM "Club" WHERE "ownerId" IN (SELECT id FROM "User" WHERE email LIKE '%@onb.test')`);
  await db.query(`DELETE FROM "User" WHERE email LIKE '%@onb.test'`);
  await db.query(`DELETE FROM "EmailCode" WHERE email LIKE '%@onb.test'`);
  await db.query(`DELETE FROM "StripeWebhookEvent" WHERE id LIKE 'evt_onb_%'`);
  await db.query(`DELETE FROM "Facility" WHERE id LIKE 'onbfac%'`);
  await db.query(`UPDATE "SubscriptionPlan" SET "stripePriceId" = NULL, "isActive" = false WHERE "stripePriceId" LIKE 'price_onb%'`);
};
await cleanup();
// The plans are on sale at the mock's Prices.
for (const [tier, [priceId]] of Object.entries(PRICES)) {
  await db.query(`UPDATE "SubscriptionPlan" SET "stripePriceId" = $2, "isActive" = true WHERE tier = $1`, [tier, priceId]);
}

const browser = await chromium.launch();
const consoleErrors = [];
const newContext = async () => {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  context.on("console", (m) => ["error", "warning"].includes(m.type()) && !m.text().includes("404") && consoleErrors.push(`${m.type()}: ${m.text()}`));
  context.on("weberror", (e) => consoleErrors.push(e.error().message));
  return context;
};
async function signUp(address) {
  const page = await (await newContext()).newPage();
  await page.goto(`${APP}/login`);
  await page.getByPlaceholder("you@example.com").fill(address);
  await page.getByRole("button", { name: "Continue with email" }).click();
  await page.waitForURL((u) => u.pathname === "/login/verify");
  await page.getByLabel("6-digit code").fill(await latestCode(address));
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL((u) => u.pathname === "/onboarding");
  return page;
}
const form = (page, name) => page.getByRole("form", { name });
const said = (scope, text) => scope.getByText(text, { exact: false }).first().waitFor({ timeout: 15_000 }).then(() => true, () => false);
const userRow = (email) => one(`SELECT id, role, "onboardedAt", "activeClubId" FROM "User" WHERE email = $1`, [email]);
const waitFor = async (fn) => {
  for (let i = 0; i < 100; i++) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
};

try {
  // 1. Step 1: "Club owner" grants nothing --------------------------------------
  const owner = await signUp(OWNER);
  await owner.getByLabel("Display name").fill("Olivia Owner");
  await owner.getByLabel("Profile handle").fill("olivia.owner");
  await owner.getByText("Club owner", { exact: true }).click();
  await owner.getByRole("button", { name: "Continue" }).click();
  await owner.waitForURL((u) => u.pathname === "/onboarding/plan");
  let me = await userRow(OWNER);
  check(me.role === "STUDENT" && me.onboardedAt === null, "choosing Club owner doesn't grant CLUB_OWNER or finish onboarding");
  await owner.goto(`${APP}/dashboard/club`);
  check(new URL(owner.url()).pathname.startsWith("/onboarding"), "the club dashboard stays closed before payment");
  await owner.goto(`${APP}/onboarding/plan?for=club`);
  const buy = form(owner, "Club plan and details");
  check((await buy.getByRole("radio", { name: /^Club Basic/ }).isChecked()) && (await buy.getByRole("radio", { name: /^Club Enterprise/ }).count()) === 1, "step 2 offers Club Basic and Club Enterprise");

  // 2. Tampering with the form ---------------------------------------------------
  await buy.getByLabel("Club name").fill("Arena E2E");
  await buy.getByLabel("Dashboard address").fill("arena-e2e");
  await buy.locator('input[name="tier"]:checked').evaluate((el) => (el.value = "FREE_COACH"));
  await buy.getByRole("button", { name: "Continue to payment" }).click();
  check(await said(buy, "Choose Club Basic or Club Enterprise"), "a forged plan (FREE_COACH) is refused");
  await buy.locator('input[name="tier"]:checked').evaluate((el) => (el.value = "CLUB_BASIC"));
  await buy.getByLabel("Dashboard address").fill("demo-padel-central");
  await buy.getByRole("button", { name: "Continue to payment" }).click();
  check(await said(buy, "That address is taken"), "an existing club's address is refused");
  check(!(await one(`SELECT 1 AS x FROM "PlanCheckout" pc JOIN "User" u ON u.id = pc."userId" WHERE u.email = $1`, [OWNER])), "…and nothing is recorded");

  // 3. Checkout, then cancel -----------------------------------------------------
  await buy.getByLabel("Dashboard address").fill("arena-e2e");
  await buy.getByText("Club Enterprise", { exact: true }).click();
  await buy.getByRole("button", { name: "Continue to payment" }).click();
  await owner.waitForURL((u) => u.href.startsWith(`${STRIPE}/pay/`));
  check(await said(owner, "Subscribe for 299 USD/month"), "Club Enterprise opens Stripe Checkout at $299/month");
  const pending = await one(`SELECT pc.kind, pc.tier, pc.status, pc."clubSlug" FROM "PlanCheckout" pc JOIN "User" u ON u.id = pc."userId" WHERE u.email = $1`, [OWNER]);
  check(pending?.kind === "CLUB_SIGNUP" && pending.tier === "CLUB_ENTERPRISE" && pending.status === "OPEN" && pending.clubSlug === "arena-e2e", "the purchase is recorded server-side (OPEN) before leaving for Stripe");
  check(!(await one(`SELECT 1 AS x FROM "Club" WHERE slug = 'arena-e2e'`)) && (await userRow(OWNER)).role === "STUDENT", "…with no club and no owner role yet");
  await owner.getByRole("button", { name: "Back" }).click();
  await owner.waitForURL((u) => u.pathname === "/onboarding/plan" && u.searchParams.get("checkout") === "cancelled");
  check(await said(owner, "Payment not completed, so no club was created"), "cancelling returns to step 2 with a notice");

  // 4. A paid subscription for the wrong Price is rejected -----------------------
  await buy.getByLabel("Club name").fill("Arena E2E");
  await buy.getByLabel("Dashboard address").fill("arena-e2e");
  await buy.getByText("Club Enterprise", { exact: true }).click();
  await buy.getByRole("button", { name: "Continue to payment" }).click();
  await owner.waitForURL((u) => u.href.startsWith(`${STRIPE}/pay/`));
  await owner.getByRole("button", { name: "Subscribe to a cheaper price" }).click();
  await owner.waitForURL((u) => u.pathname === "/onboarding/complete");
  check(await said(owner, "We couldn't finish setting up"), "an Enterprise checkout paid at the Basic price is rejected after the webhook");
  check(
    !(await one(`SELECT 1 AS x FROM "Club" WHERE slug = 'arena-e2e'`)) && (await userRow(OWNER)).role === "STUDENT" &&
      (await one(`SELECT pc.status FROM "PlanCheckout" pc JOIN "User" u ON u.id = pc."userId" WHERE u.email = $1 ORDER BY pc."createdAt" DESC LIMIT 1`, [OWNER]))?.status === "FAILED",
    "…no club, no role, and the checkout is flagged FAILED for support",
  );

  // 5. A forged webhook is refused ----------------------------------------------
  const forged = JSON.stringify({ id: "evt_onb_forged", object: "event", type: "checkout.session.completed", data: { object: { id: "cs_x", mode: "subscription", status: "complete", metadata: { planCheckoutId: "x" } } } });
  const forgedRes = await fetch(`${APP}/api/webhooks/stripe`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=deadbeef" }, body: forged });
  check(forgedRes.status === 400, "a webhook without a valid Stripe signature is a 400");

  // 6. Paying provisions the club, the subscription and the role ------------------
  await owner.goto(`${APP}/onboarding/plan?for=club`);
  await buy.getByLabel("Club name").fill("Arena E2E");
  await buy.getByLabel("Dashboard address").fill("arena-e2e");
  await buy.getByRole("textbox", { name: /^City/ }).fill("Valencia");
  await buy.getByRole("button", { name: "Continue to payment" }).click(); // Club Basic (default)
  await owner.waitForURL((u) => u.href.startsWith(`${STRIPE}/pay/`));
  check(await said(owner, "Subscribe for 99 USD/month"), "Club Basic opens Stripe Checkout at $99/month");
  await owner.getByRole("button", { name: "Subscribe", exact: true }).click();
  await owner.waitForURL((u) => u.pathname === "/onboarding/complete");
  check(await said(owner, "Confirming your payment"), "back from Stripe before the webhook: 'Confirming your payment…'");
  await owner.waitForURL((u) => u.pathname === "/dashboard/arena-e2e", { timeout: 20_000 });
  check(true, "…and the page moves on to the new club's dashboard once the webhook lands");
  me = await userRow(OWNER);
  const arena = await one(`SELECT id, status, "ownerId" FROM "Club" WHERE slug = 'arena-e2e'`);
  const arenaSub = await one(`SELECT tier, status, "stripePriceId" FROM "Subscription" WHERE "clubId" = $1`, [arena?.id]);
  check(arena?.status === "ACTIVE" && arena.ownerId === me.id, "the club is created ACTIVE, owned by the buyer");
  check(arenaSub?.tier === "CLUB_BASIC" && arenaSub.status === "ACTIVE" && arenaSub.stripePriceId === PRICES.CLUB_BASIC[0], "…with an ACTIVE Club Basic subscription");
  check(me.role === "CLUB_OWNER" && me.onboardedAt !== null && me.activeClubId === arena.id, "the buyer is now CLUB_OWNER and onboarded (granted by the webhook)");
  check(Boolean(await one(`SELECT 1 AS x FROM "ClubMember" WHERE "clubId" = $1 AND "userId" = $2 AND role = 'OWNER' AND status = 'ACTIVE'`, [arena.id, me.id])), "…with an OWNER membership");

  // 7. Replays don't create anything twice ---------------------------------------
  const delivered = webhooks.at(-1);
  const replay = await fetch(`${APP}/api/webhooks/stripe`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": signer.webhooks.generateTestHeaderString({ payload: delivered.payload, secret: WEBHOOK_SECRET }) }, body: delivered.payload });
  const resent = await sendWebhook("checkout.session.completed", JSON.parse(delivered.payload).data.object);
  const counts = await one(
    `SELECT (SELECT count(*)::int FROM "Club" WHERE "ownerId" = $1) AS clubs, (SELECT count(*)::int FROM "Subscription" s JOIN "Club" c ON c.id = s."clubId" WHERE c."ownerId" = $1) AS subs`,
    [me.id],
  );
  check(replay.status === 200 && resent.status === 200 && counts.clubs === 1 && counts.subs === 1, "the same event replayed, or re-sent as a new event, creates no second club or subscription");

  // 8. Club Basic limits and Enterprise features ----------------------------------
  for (let i = 1; i <= 5; i++) {
    await db.query(`INSERT INTO "Facility"(id, "clubId", name, type, "openMinute", "closeMinute", "hourlyRateAmount", "updatedAt") VALUES ($1, $2, $3, 'PADEL_COURT', 480, 1320, 2000, now())`, [`onbfac${i}`, arena.id, `Court ${i}`]);
  }
  await owner.goto(`${APP}/dashboard/arena-e2e/facilities`);
  const addFacility = form(owner, "Add a facility");
  await addFacility.getByLabel("Name").fill("Court 6");
  await addFacility.getByLabel("Type").selectOption("PADEL_COURT");
  await addFacility.getByLabel(/^Standard rate per hour/).fill("20");
  await addFacility.getByLabel("Opens").fill("08:00");
  await addFacility.getByLabel("Closes").fill("22:00");
  await addFacility.getByRole("button", { name: "Add facility" }).click();
  check(await said(addFacility, "Your Club Basic plan includes 5 active facilities"), "Club Basic: a 6th court is refused by the server");
  check((await one(`SELECT count(*)::int AS n FROM "Facility" WHERE "clubId" = $1`, [arena.id])).n === 5, "…and not created");
  await owner.goto(`${APP}/dashboard/arena-e2e`);
  check(await said(owner, "Occupancy heatmaps are part of Club Enterprise"), "Club Basic: heatmaps are an upgrade prompt");
  await owner.goto(`${APP}/dashboard/arena-e2e/staff`);
  check(await said(owner, "Monthly payout reports are part of Club Enterprise"), "Club Basic: payroll is an upgrade prompt");

  // 9. PAST_DUE locks the club; paying again unlocks it ----------------------------
  const stripeSub = subscriptions.get((await one(`SELECT "stripeSubscriptionId" AS id FROM "Subscription" WHERE "clubId" = $1`, [arena.id])).id);
  await owner.goto(`${APP}/dashboard/arena-e2e/facilities`);
  stripeSub.status = "past_due";
  check((await sendWebhook("customer.subscription.updated", stripeSub)).status === 200, "customer.subscription.updated (past_due) is accepted");
  check(await waitFor(async () => (await one(`SELECT status FROM "Subscription" WHERE "clubId" = $1`, [arena.id])).status === "PAST_DUE"), "…and the club's subscription is PAST_DUE");
  await addFacility.getByLabel("Name").fill("Court 6");
  await db.query(`UPDATE "Facility" SET "isActive" = false WHERE id = 'onbfac5'`);
  await addFacility.getByRole("button", { name: "Add facility" }).click();
  check(await said(addFacility, "subscription is past due"), "a past-due club can't write, even under its limits");
  await owner.goto(`${APP}/dashboard/arena-e2e/schedule`);
  check(new URL(owner.url()).pathname === "/dashboard/arena-e2e" && (await said(owner, "dashboard is locked")), "sections redirect to the locked overview");
  await owner.goto(`${APP}/dashboard/arena-e2e/billing`);
  await owner.getByRole("button", { name: "Manage billing" }).click();
  await owner.waitForURL((u) => u.href === `${STRIPE}/portal`);
  check(true, "billing stays open and 'Manage billing' opens the Stripe portal");
  // A customer id Stripe doesn't know (another account, or the demo seed's made-up ids).
  const realCustomer = (await one(`SELECT "stripeCustomerId" AS id FROM "Subscription" WHERE "clubId" = $1`, [arena.id])).id;
  await db.query(`UPDATE "Subscription" SET "stripeCustomerId" = 'cus_demo04' WHERE "clubId" = $1`, [arena.id]);
  await owner.goto(`${APP}/dashboard/arena-e2e/billing`);
  await owner.getByRole("button", { name: "Manage billing" }).click();
  check(await said(owner, "Stripe has no record of this club's billing account"), "a customer missing from Stripe gets a clear message, not 'Stripe is unavailable'");
  await db.query(`UPDATE "Subscription" SET "stripeCustomerId" = $2 WHERE "clubId" = $1`, [arena.id, realCustomer]);
  stripeSub.status = "active";
  await sendWebhook("customer.subscription.updated", stripeSub);
  await waitFor(async () => (await one(`SELECT status FROM "Subscription" WHERE "clubId" = $1`, [arena.id])).status === "ACTIVE");
  await owner.goto(`${APP}/dashboard/arena-e2e/schedule`);
  check(new URL(owner.url()).pathname === "/dashboard/arena-e2e/schedule", "once paid (active again), the dashboard unlocks");
  stripeSub.status = "canceled";
  await sendWebhook("customer.subscription.deleted", stripeSub);
  await waitFor(async () => (await one(`SELECT status FROM "Subscription" WHERE "clubId" = $1`, [arena.id])).status === "CANCELED");
  await owner.goto(`${APP}/dashboard/arena-e2e/billing`);
  check(await owner.getByRole("button", { name: /^Choose Club Basic/ }).isVisible(), "a cancelled subscription locks the club and offers a new plan");

  // 10. Free Coach: 15 active students; Pro Coach: unlimited -----------------------
  const coachPage = await signUp(COACH);
  await coachPage.getByLabel("Display name").fill("Carla Coach");
  await coachPage.getByLabel("Profile handle").fill("carla.coach");
  await coachPage.getByText("Coach", { exact: true }).click();
  await coachPage.getByRole("button", { name: "Continue" }).click();
  await coachPage.waitForURL((u) => u.pathname === "/onboarding/plan");
  await coachPage.getByRole("link", { name: "Continue with Free Coach" }).click();
  await coachPage.waitForURL((u) => u.pathname === "/dashboard/coach");
  const coach = await userRow(COACH);
  check(coach.role === "COACH" && coach.onboardedAt !== null, "Free Coach needs no payment: COACH and onboarded");
  // On Padel Central's roster, with 15 students in private sessions this month.
  const sport = await one(`SELECT id FROM "Sport" WHERE "isActive" ORDER BY name LIMIT 1`);
  await db.query(`INSERT INTO "ClubMember"(id, "clubId", "userId", role, status, "employmentType", "commissionBps", "joinedAt", "updatedAt") VALUES ('onbmember', 'democlub01', $1, 'COACH', 'ACTIVE', 'FREELANCE', 7000, now(), now())`, [coach.id]);
  await db.query(`INSERT INTO "Facility"(id, "clubId", name, type, "openMinute", "closeMinute", "hourlyRateAmount", "updatedAt") VALUES ('onbfaccoach', 'democlub01', 'Onboarding Court', 'PADEL_COURT', 420, 1380, 2000, now())`);
  for (let i = 1; i <= 16; i++) {
    const sid = `onbstudent${i}`;
    await db.query(`INSERT INTO "User"(id, email, name, role, "emailVerified", "onboardedAt", "updatedAt") VALUES ($1, $2, $3, 'STUDENT', now(), now(), now())`, [sid, `student${i}@onb.test`, `Student ${i}`]);
    if (i === 16) break;
    await db.query(
      `INSERT INTO "PracticeSession"(id, "clubId", "facilityId", "coachId", "sportId", "createdById", title, kind, "startsAt", "endsAt", status, "maxParticipants", "priceAmount", currency, "coachShareBps", "updatedAt")
       VALUES ($1, 'democlub01', 'onbfaccoach', $2, $3, $2, 'Private lesson', 'PRIVATE', date_trunc('hour', now()) - make_interval(days => $4), date_trunc('hour', now()) - make_interval(days => $4) + interval '1 hour', 'SCHEDULED', 1, 0, 'eur', 7000, now())`,
      [`onbsession${i}`, coach.id, sport.id, i],
    );
    await db.query(`INSERT INTO "SessionParticipant"(id, "sessionId", "userId", status, "respondedAt", "updatedAt") VALUES ($1, $2, $3, 'ACCEPTED', now(), now())`, [`onbpart${i}`, `onbsession${i}`, sid]);
    await db.query(`UPDATE "PracticeSession" SET status = 'COMPLETED' WHERE id = $1`, [`onbsession${i}`]);
  }
  const nextWeek = (await one(`SELECT to_char((now() AT TIME ZONE 'Europe/Madrid') + interval '7 days', 'YYYY-MM-DD') AS d`)).d;
  const schedulePrivate = async (title, student, from) => {
    await coachPage.goto(`${APP}/dashboard/coach`);
    await coachPage.getByRole("button", { name: "New session" }).click();
    const modal = form(coachPage, "New session");
    await modal.getByLabel("Type").selectOption("PRIVATE");
    await modal.getByLabel("Title").fill(title);
    await modal.getByLabel("Club · facility").selectOption({ label: "Padel Central · Onboarding Court" });
    await modal.locator('select[name="sportId"]').selectOption(sport.id);
    await modal.getByLabel("Date").fill(nextWeek);
    await modal.getByLabel(/^From/).fill(from);
    await modal.getByLabel(/^Until/).fill(`${Number(from.slice(0, 2)) + 1}:00`);
    await modal.getByLabel("Add a student (email)").fill(student);
    await modal.getByRole("button", { name: "Schedule" }).click();
    return modal;
  };
  let modal = await schedulePrivate("Returning student", "student3@onb.test", "10:00");
  check(await said(modal, "Scheduled “Returning student”"), "Free Coach at 15 students: a returning student can still book");
  modal = await schedulePrivate("Sixteenth student", "student16@onb.test", "12:00");
  check(await said(modal, "Free Coach includes 15 active students"), "…but a 16th student is refused by the server");
  check(!(await one(`SELECT 1 AS x FROM "PracticeSession" WHERE title = 'Sixteenth student'`)), "…and no session is left behind");

  await coachPage.goto(`${APP}/dashboard/coach/availability`);
  await coachPage.getByRole("button", { name: "Upgrade to Pro Coach" }).click();
  await coachPage.waitForURL((u) => u.href.startsWith(`${STRIPE}/pay/`));
  check(await said(coachPage, "Subscribe for 29 USD/month"), "Upgrade to Pro Coach opens Stripe Checkout at $29/month");
  check((await userRow(COACH)).role === "COACH" && !(await one(`SELECT 1 AS x FROM "Subscription" WHERE "userId" = $1`, [coach.id])), "…and nothing changes before payment");
  await coachPage.getByRole("button", { name: "Subscribe", exact: true }).click();
  await coachPage.waitForURL((u) => u.pathname === "/dashboard/coach" && u.searchParams.get("upgraded") === "1", { timeout: 20_000 });
  check(await said(coachPage, "You're on Pro Coach"), "after the webhook the coach lands on the dashboard as Pro");
  modal = await schedulePrivate("Sixteenth student", "student16@onb.test", "12:00");
  check(await said(modal, "Scheduled “Sixteenth student”"), "Pro Coach: the 16th student is accepted");

  check(consoleErrors.length === 0, `no browser console errors or warnings${consoleErrors.length ? `:\n  ${[...new Set(consoleErrors)].join("\n  ")}` : ""}`);
} catch (error) {
  failures++;
  console.error(error);
  console.error(appLog.split("\n").slice(-40).join("\n"));
} finally {
  if (process.env.E2E_APP_LOG) (await import("node:fs")).writeFileSync(process.env.E2E_APP_LOG, appLog);
  await db.query(`DELETE FROM "PracticeSession" WHERE "facilityId" = 'onbfaccoach'`).catch(() => {});
  await cleanup().catch((e) => console.error(e));
  await db.end();
  await browser.close();
  process.kill(-app.pid, "SIGTERM");
  stripeServer.close();
  smtp.close();
  seed();
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall onboarding e2e checks passed");
process.exit(failures ? 1 : 0);
