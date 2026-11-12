// End-to-end test of Stripe Connect onboarding for clubs and coaches:
// connecting (owner only), leaving and resuming Stripe's hosted onboarding,
// an expired link, the account.updated webhook on the Connect endpoint
// (second signing secret), online court booking switching on, the Stripe
// dashboard link, a seat payment's shares sent to the club at once and to
// the coach once they finish onboarding (an Accounts v2 thin event, third
// signing secret; from the original charge), a
// partial refund reversing the same fraction of both, and a deauthorized
// account switching online booking off again.
//
//   DATABASE_URL=postgresql://... npm run test:e2e:connect
//
// Runs against a local mock of the Stripe API (no network). Re-seeds the
// demo data before and after.
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";

import pg from "pg";
import { chromium } from "playwright";
import { SMTPServer } from "smtp-server";
import Stripe from "stripe";

const APP = "http://localhost:3406";
const DATABASE_URL = process.env.DATABASE_URL?.split("?")[0];
if (!DATABASE_URL) throw new Error("Set DATABASE_URL");
const CLUB = "/dashboard/demo-riverside-racquets";

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
await new Promise((r) => smtp.listen(2532, "127.0.0.1", r));
async function latestCode(address) {
  for (let i = 0; i < 100; i++) {
    const subject = inbox.filter((m) => m.to.includes(address)).at(-1)?.raw.match(/^Subject: (\d{3}) (\d{3}) is your nexport code/m);
    if (subject) return subject[1] + subject[2];
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`no code for ${address}`);
}

// --- Mock Stripe -------------------------------------------------------------
const STRIPE = "http://127.0.0.1:12113";
const WEBHOOK_SECRET = "whsec_e2e_connect_platform";
const CONNECT_SECRET = "whsec_e2e_connect_accounts";
const V2_SECRET = "whsec_e2e_connect_thin";
const signer = new Stripe("sk_test_e2e");
const accounts = new Map();
const links = new Map();
const calls = [];
let seq = 0;
const RUN = Date.now().toString(36); // event ids unique per run: the app ignores ids it has already processed
async function sendWebhook(type, object, { secret = WEBHOOK_SECRET, account } = {}) {
  const payload = JSON.stringify({ id: `evt_conn_${RUN}_${++seq}`, object: "event", type, livemode: false, created: Math.floor(Date.now() / 1000), api_version: "2026-09-30.endive", ...(account ? { account } : {}), data: { object } });
  const header = signer.webhooks.generateTestHeaderString({ payload, secret });
  return fetch(`${APP}/api/webhooks/stripe`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": header }, body: payload });
}
// Accounts v2 thin event notification: only the account's id; the app reads the rest from the API.
async function sendThinEvent(type, accountId, { secret = V2_SECRET } = {}) {
  const payload = JSON.stringify({ id: `evt_conn_${RUN}_${++seq}`, object: "v2.core.event", type, livemode: false, created: new Date().toISOString(), related_object: { id: accountId, type: "v2.core.account", url: `/v2/core/accounts/${accountId}` } });
  const header = signer.webhooks.generateTestHeaderString({ payload, secret });
  return fetch(`${APP}/api/webhooks/stripe`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": header }, body: payload });
}
// An Accounts v2 object (merchant + recipient configurations), before or after onboarding.
const cap = (status) => ({ status, status_details: status === "active" ? [] : [{ code: "requirements_past_due", resolution: "provide_info" }] });
const due = (description) => ({ awaiting_action_from: "user", description, errors: [], impact: {}, minimum_deadline: { status: "currently_due" }, requested_reasons: [{ code: "routine_onboarding" }] });
function setCapabilities(account, status) {
  account.configuration = {
    merchant: { applied: true, capabilities: { card_payments: cap(status), stripe_balance: { payouts: cap(status) } } },
    recipient: { applied: true, capabilities: { stripe_balance: { stripe_transfers: cap(status), payouts: cap(status) } } },
  };
  account.requirements = { entries: status === "active" ? [] : [due("external_account"), due("tos_acceptance.date")] };
}
function newAccount(id, params) {
  const account = {
    id,
    object: "v2.core.account",
    applied_configurations: ["merchant", "recipient"],
    created: new Date().toISOString(),
    livemode: false,
    dashboard: params.dashboard,
    display_name: params.display_name,
    contact_email: params.contact_email,
    identity: { country: params.identity?.country, entity_type: params.identity?.entity_type },
    defaults: { currency: "eur", responsibilities: params.defaults?.responsibilities },
    metadata: params.metadata,
  };
  setCapabilities(account, "restricted");
  return account;
}
const stripeServer = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const url = new URL(req.url, STRIPE);
  // v1 is form-encoded, v2 is JSON.
  const v2 = url.pathname.startsWith("/v2/");
  const form = new URLSearchParams(v2 ? "" : body);
  const params = v2 && body ? JSON.parse(body) : {};
  const json = (status, data) => (res.writeHead(status, { "content-type": "application/json", "request-id": `req_${++seq}` }), res.end(JSON.stringify(data)));
  const html = (markup) => (res.writeHead(200, { "content-type": "text/html; charset=utf-8" }), res.end(`<!doctype html><title>Mock Stripe</title>${markup}`));
  calls.push({ method: req.method, path: url.pathname, form: Object.fromEntries(form), params });

  // Stripe-hosted onboarding.
  const onboard = url.pathname.match(/^\/connect\/onboard\/(acct_conn_\d+)\/(\w+)(\/(finish|leave))?$/);
  if (onboard) {
    const link = links.get(onboard[2]);
    if (!onboard[3]) {
      return html(
        `<h1>Set up payouts for ${onboard[1]}</h1><form method="post" action="${url.pathname}/finish"><button>Finish setup</button></form>` +
          `<form method="post" action="${url.pathname}/leave"><button>Leave for now</button></form>`,
      );
    }
    const account = accounts.get(onboard[1]);
    if (onboard[4] === "finish") {
      setCapabilities(account, "active");
      if (account.metadata?.clubId) {
        // v1 account.updated comes from the Connect endpoint, signed with its own secret (a v1-shaped object: the app re-reads it via v2).
        await sendWebhook("account.updated", { id: account.id, object: "account" }, { secret: CONNECT_SECRET, account: account.id });
      } else {
        // Accounts v2 thin event, from the thin-payload event destination (third secret).
        await sendThinEvent("v2.core.account[configuration.recipient].capability_status_updated", account.id);
      }
    }
    return (res.writeHead(303, { location: link.return_url }), res.end());
  }
  const express = url.pathname.match(/^\/express\/(acct_conn_\d+)$/);
  if (express) return html(`<h1>Mock Express dashboard for ${express[1]}</h1>`);

  // Like Stripe now: new platforms can't create v1 accounts.
  if (req.method === "POST" && url.pathname === "/v1/accounts") {
    return json(400, { error: { type: "invalid_request_error", message: "Stripe no longer recommends Accounts v1 for new Connect integrations. Create connected accounts with POST /v2/core/accounts instead." } });
  }
  if (req.method === "POST" && url.pathname === "/v2/core/accounts") {
    const account = newAccount(`acct_conn_${++seq}`, params);
    accounts.set(account.id, account);
    return json(200, account);
  }
  const acct = url.pathname.match(/^\/(v1|v2\/core)\/accounts\/(acct_[a-z_]*\d+)(\/login_links)?$/);
  if (acct) {
    const account = accounts.get(acct[2]);
    if (!account) return json(404, { error: { type: "invalid_request_error", code: "resource_missing", message: "No such account" } });
    if (account.deauthorized) return json(403, { error: { type: "invalid_request_error", code: "account_invalid", message: "The provided key does not have access to account" } });
    if (acct[1] === "v1" && acct[3]) return json(200, { object: "login_link", url: `${STRIPE}/express/${account.id}` });
    if (acct[1] === "v2/core" && !acct[3] && req.method === "GET") return json(200, account);
  }
  if (req.method === "POST" && url.pathname === "/v2/core/account_links") {
    const id = `link${++seq}`;
    const onboarding = params.use_case?.account_onboarding ?? {};
    links.set(id, { return_url: onboarding.return_url, refresh_url: onboarding.refresh_url });
    return json(200, { object: "v2.core.account_link", account: params.account, url: `${STRIPE}/connect/onboard/${params.account}/${id}`, created: new Date().toISOString(), expires_at: new Date(Date.now() + 300_000).toISOString(), livemode: false, use_case: params.use_case });
  }
  const intent = url.pathname.match(/^\/v1\/payment_intents\/(pi_[\w]+)$/);
  if (req.method === "GET" && intent) return json(200, { id: intent[1], object: "payment_intent", status: "succeeded", latest_charge: `ch_${intent[1].slice(3)}` });
  if (req.method === "POST" && url.pathname === "/v1/transfers") return json(200, { id: `tr_conn_${++seq}`, object: "transfer", amount: Number(form.get("amount")), destination: form.get("destination") });
  const reversal = url.pathname.match(/^\/v1\/transfers\/(tr_conn_\d+)\/reversals$/);
  if (req.method === "POST" && reversal) return json(200, { id: `trr_conn_${++seq}`, object: "transfer_reversal", amount: Number(form.get("amount")), transfer: reversal[1] });
  if (req.method === "POST" && url.pathname === "/v1/refunds") return json(200, { id: `re_conn_${++seq}`, object: "refund", amount: Number(form.get("amount")), status: "succeeded" });
  json(404, { error: { type: "invalid_request_error", message: `mock: no route ${req.method} ${url.pathname}` } });
});
await new Promise((r) => stripeServer.listen(12113, "127.0.0.1", r));

// --- App -----------------------------------------------------------------------
const app = spawn("npx", ["next", "dev", "-p", "3406"], {
  env: {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: "1",
    DATABASE_URL,
    AUTH_SECRET: "e2e-connect-secret-e2e-connect-secret-x",
    AUTH_URL: APP,
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: "2532",
    EMAIL_FROM: "nexport <no-reply@e2e-connect.test>",
    STRIPE_SECRET_KEY: "sk_test_e2e",
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    STRIPE_CONNECT_WEBHOOK_SECRET: CONNECT_SECRET,
    STRIPE_V2_WEBHOOK_SECRET: V2_SECRET,
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
// Riverside Racquets (club 5, trialing) starts without a Stripe account; coach03 has none either.
await db.query(`DELETE FROM "StripeAccount" WHERE "clubId" = 'democlub05' OR "userId" = 'democoach03'`);
await db.query(`DELETE FROM "EmailCode" WHERE email LIKE '%@demo.nexport.test'`);
await db.query(`DELETE FROM "StripeWebhookEvent" WHERE id LIKE 'evt_conn_%'`);

const browser = await chromium.launch();
const consoleErrors = [];
const newContext = async () => {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  context.on("console", (m) => ["error", "warning"].includes(m.type()) && !m.text().includes("404") && consoleErrors.push(`${m.type()}: ${m.text()}`));
  context.on("weberror", (e) => consoleErrors.push(e.error().message));
  // Stripe.js is loaded on the athlete's booking page; no network here, so serve a stub.
  await context.route("https://js.stripe.com/**", (route) => route.fulfill({ contentType: "text/javascript", body: "window.Stripe = function () { return { elements() { return { create() { return { mount() {} }; } }; } }; };" }));
  return context;
};
async function emailSignIn(address) {
  const page = await (await newContext()).newPage();
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
const said = (scope, text) => scope.getByText(text, { exact: false }).first().waitFor({ timeout: 15_000 }).then(() => true, () => false);
const waitFor = async (fn) => {
  for (let i = 0; i < 100; i++) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
};
const bookableClubs = async (page) => {
  await page.goto(`${APP}/dashboard/student/book`);
  return (await page.locator("select option").allInnerTexts()).join(" | ");
};

try {
  // 1. A club with no account: desk only ------------------------------------------
  const athlete = await emailSignIn("athlete01@demo.nexport.test");
  check(!(await bookableClubs(athlete)).includes("Riverside Racquets"), "a club without a Stripe account isn't offered for online booking");
  const owner = await emailSignIn("owner05@demo.nexport.test");
  await owner.goto(`${APP}${CLUB}/facilities`);
  check(await said(owner, "Courts are bookable at the desk only"), "Facilities says courts are desk-only, with a link to connect Stripe");
  await owner.goto(`${APP}${CLUB}/billing`);
  check(await said(owner, "No Stripe account is connected yet"), "Billing explains what connecting unlocks");

  // 2. Connect, leave halfway, resume, expired link --------------------------------
  await owner.getByRole("button", { name: "Connect with Stripe" }).click();
  await owner.waitForURL((u) => u.href.startsWith(`${STRIPE}/connect/onboard/`));
  const created = calls.find((c) => c.path === "/v2/core/accounts")?.params;
  check(
    created?.identity?.country === "ES" &&
      created.metadata?.clubId === "democlub05" &&
      created.dashboard === "express" &&
      created.defaults?.responsibilities?.fees_collector === "application" &&
      created.defaults.responsibilities.losses_collector === "application" &&
      created.configuration?.merchant?.capabilities?.card_payments?.requested === true &&
      created.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.requested === true &&
      !calls.some((c) => c.path === "/v1/accounts"),
    "an Accounts v2 account (Express dashboard) is created in the club's country, for card payments and transfers",
  );
  const linkCall = calls.find((c) => c.path === "/v2/core/account_links")?.params;
  check(linkCall?.use_case?.type === "account_onboarding" && linkCall.use_case.account_onboarding?.return_url?.endsWith(`${CLUB}/billing?connect=return`), "…and onboarding uses a v2 account link back to Billing");
  const clubAcct = await one(`SELECT "stripeAccountId", status, "chargesEnabled" FROM "StripeAccount" WHERE "clubId" = 'democlub05'`);
  check(clubAcct?.status === "ONBOARDING" && !clubAcct.chargesEnabled, "…stored as ONBOARDING, before Stripe hosts the onboarding");
  await owner.getByRole("button", { name: "Leave for now" }).click();
  await owner.waitForURL((u) => u.pathname === `${CLUB}/billing` && u.searchParams.get("connect") === "return");
  check(await owner.getByRole("button", { name: "Continue setup in Stripe" }).isVisible(), "leaving halfway: Billing offers to continue setup");
  check(await said(owner, "Bank account for payouts"), "…and lists what Stripe still needs, in words");
  const refresh = await owner.request.get(`${APP}${CLUB}/billing/connect`, { maxRedirects: 0 });
  check(refresh.status() === 303 && refresh.headers().location?.startsWith(`${STRIPE}/connect/onboard/${clubAcct.stripeAccountId}/`), "an expired link (refresh_url) is replaced by a fresh one");
  const stranger = await emailSignIn("owner01@demo.nexport.test");
  const r = await stranger.request.get(`${APP}${CLUB}/billing/connect`, { maxRedirects: 0 });
  check(r.status() === 404, "another club's owner gets a 404, not an onboarding link");

  // 3. Finish: account.updated on the Connect endpoint, online booking switches on ----
  await owner.getByRole("button", { name: "Continue setup in Stripe" }).click();
  await owner.waitForURL((u) => u.href.startsWith(`${STRIPE}/connect/onboard/`));
  await owner.getByRole("button", { name: "Finish setup" }).click();
  await owner.waitForURL((u) => u.pathname === `${CLUB}/billing`);
  check(await said(owner, "All set. Stripe can take payments"), "after finishing, Billing shows the account as all set");
  const active = await one(`SELECT status, "chargesEnabled", "payoutsEnabled", "transfersEnabled", "detailsSubmitted" FROM "StripeAccount" WHERE "clubId" = 'democlub05'`);
  check(active.status === "ACTIVE" && active.chargesEnabled && active.payoutsEnabled && active.transfersEnabled && active.detailsSubmitted, "account.updated (signed with the Connect endpoint's secret) stores the account as ACTIVE");
  check((await bookableClubs(athlete)).includes("Riverside Racquets"), "the club's courts can now be booked online");
  await owner.goto(`${APP}${CLUB}/facilities`);
  check((await owner.getByText("Courts are bookable at the desk only").count()) === 0, "…and Facilities no longer says desk-only");
  await owner.goto(`${APP}${CLUB}/billing`);
  await owner.getByRole("button", { name: "Open Stripe dashboard" }).click();
  await owner.waitForURL((u) => u.href === `${STRIPE}/express/${clubAcct.stripeAccountId}`);
  check(true, "Open Stripe dashboard signs the owner into their Express dashboard");

  // 4. A coach connects; a seat's shares are sent, the coach's once they finish ------
  const coach = await emailSignIn("coach03@demo.nexport.test");
  await coach.goto(`${APP}/dashboard/coach/earnings`);
  const connectForm = coach.getByRole("form", { name: "Connect with Stripe" });
  await connectForm.getByLabel("Country you're based in").selectOption("PT");
  await connectForm.getByRole("button", { name: "Connect with Stripe" }).click();
  await coach.waitForURL((u) => u.href.startsWith(`${STRIPE}/connect/onboard/`));
  const coachCreate = calls.filter((c) => c.path === "/v2/core/accounts").at(-1).params;
  check(coachCreate.identity?.country === "PT" && coachCreate.identity.entity_type === "individual" && coachCreate.metadata?.userId === "democoach03", "a coach's account is individual, in the country they picked");
  await coach.getByRole("button", { name: "Leave for now" }).click();
  await coach.waitForURL((u) => u.pathname === "/dashboard/coach/earnings");

  // A paid seat in coach03's group class at Padel Central, 10 hours from now.
  await db.query(`INSERT INTO "Facility"(id, "clubId", name, type, "openMinute", "closeMinute", "hourlyRateAmount") VALUES ('connfac', 'democlub01', 'Connect Court', 'PADEL_COURT', 0, 1440, 2000)`);
  await db.query(
    `INSERT INTO "PracticeSession"(id, "clubId", "facilityId", "coachId", "sportId", "createdById", title, kind, "startsAt", "endsAt", status, "maxParticipants", "priceAmount", currency, "coachShareBps", "cancellationPolicyId")
     VALUES ('connsession', 'democlub01', 'connfac', 'democoach03', (SELECT id FROM "Sport" WHERE slug = 'padel'), 'democoach03', 'E2E Connect clinic', 'GROUP',
             date_trunc('minute', now()) + interval '10 hours', date_trunc('minute', now()) + interval '11 hours', 'SCHEDULED', 6, 2000, 'eur', 7000, 'demopolicy01')`,
  );
  await db.query(`INSERT INTO "SessionParticipant"(id, "sessionId", "userId", status, "respondedAt") VALUES ('connpart', 'connsession', 'demoathlete01', 'ACCEPTED', now())`);
  await db.query(
    `INSERT INTO "PaymentTransaction"(id, "clubId", kind, "sessionId", "participantId", "payerId", amount, currency, "applicationFeeAmount", status,
       "stripeCheckoutSessionId", "checkoutExpiresAt", "transferGroup", "idempotencyKey")
     VALUES ('connpay', 'democlub01', 'SESSION', 'connsession', 'connpart', 'demoathlete01', 2000, 'eur', 60, 'REQUIRES_PAYMENT_METHOD', 'cs_connseat', now() + interval '30 minutes', 'connpay', 'connpay')`,
  );
  const settled = await sendWebhook("checkout.session.completed", { id: "cs_connseat", object: "checkout.session", mode: "payment", status: "complete", payment_status: "paid", payment_intent: "pi_connseat", metadata: { paymentId: "connpay" } });
  check(settled.status === 200, "the seat payment's checkout.session.completed is accepted");
  const shares = async () => Object.fromEntries((await db.query(`SELECT "recipientType", status, amount, "reversedAmount", "stripeTransferId" FROM "PaymentTransfer" WHERE "paymentId" = 'connpay'`)).rows.map((r) => [r.recipientType, r]));
  let s = await waitFor(async () => {
    const x = await shares();
    return x.CLUB?.status === "PAID" ? x : null;
  });
  const sent = calls.filter((c) => c.path === "/v1/transfers");
  check(
    s?.CLUB.status === "PAID" && s.CLUB.stripeTransferId?.startsWith("tr_conn_") && sent.length === 1 && sent[0].form.destination === "acct_demo01" && sent[0].form.source_transaction === "ch_connseat" && Number(sent[0].form.amount) === s.CLUB.amount,
    "the club's share is sent at once, from the original charge (source_transaction)",
  );
  check(s?.COACH?.status === "PENDING", "the coach's share waits: their account can't receive transfers yet");
  await coach.reload();
  check(await said(coach, "waiting and will be sent as soon as Stripe enables transfers"), "Earnings tells the coach a payment is waiting for their setup");

  await coach.getByRole("button", { name: "Continue setup in Stripe" }).click();
  await coach.waitForURL((u) => u.href.startsWith(`${STRIPE}/connect/onboard/`));
  await coach.getByRole("button", { name: "Finish setup" }).click();
  await coach.waitForURL((u) => u.pathname === "/dashboard/coach/earnings");
  s = await waitFor(async () => {
    const x = await shares();
    return x.COACH?.status === "PAID" ? x : null;
  });
  const coachAcct = (await one(`SELECT "stripeAccountId" FROM "StripeAccount" WHERE "userId" = 'democoach03'`)).stripeAccountId;
  const coachSent = calls.filter((c) => c.path === "/v1/transfers" && c.form.destination === coachAcct);
  check(s?.COACH.status === "PAID" && coachSent.length === 1 && Number(coachSent[0].form.amount) === s.COACH.amount, "once the coach finishes, their waiting share is sent (exactly once)");
  const thin = await one(`SELECT type, "processedAt", error FROM "StripeWebhookEvent" WHERE id LIKE 'evt_conn_${RUN}_%' AND type LIKE 'v2.core.account%' ORDER BY "createdAt" DESC LIMIT 1`);
  check(thin?.processedAt && !thin.error, "the Accounts v2 thin event (third signing secret) is verified and processed");

  // 5. A 50% refund takes back half of each share ------------------------------------
  await athlete.goto(`${APP}/dashboard/student/bookings`);
  const card = athlete.getByRole("article").filter({ hasText: "E2E Connect clinic" });
  await card.getByRole("button", { name: /^Cancel/ }).click();
  check(await said(athlete, "(50%) is on its way back to your card"), "the athlete cancels 10 hours out and gets 50% back (club policy)");
  const after = await shares();
  const reversals = calls.filter((c) => /\/v1\/transfers\/tr_conn_\d+\/reversals$/.test(c.path));
  check(
    after.CLUB.reversedAmount === Math.round(after.CLUB.amount / 2) && after.COACH.reversedAmount === Math.round(after.COACH.amount / 2) && reversals.length === 2,
    "half of the club's and half of the coach's share are reversed in Stripe",
  );

  // 6. Deauthorized: online booking off again --------------------------------------------
  accounts.get(clubAcct.stripeAccountId).deauthorized = true;
  const deauth = await sendWebhook("account.application.deauthorized", { id: "ca_conn", object: "application" }, { secret: CONNECT_SECRET, account: clubAcct.stripeAccountId });
  check(deauth.status === 200, "account.application.deauthorized is accepted");
  check(!(await bookableClubs(athlete)).includes("Riverside Racquets"), "a club that disconnected nexport in Stripe can't be booked online any more");
  await owner.goto(`${APP}${CLUB}/billing`);
  check(await said(owner, "disconnected from nexport"), "Billing says the account was disconnected");
  await owner.getByRole("button", { name: "Connect a new Stripe account" }).click();
  await owner.waitForURL((u) => u.href.startsWith(`${STRIPE}/connect/onboard/`));
  const replaced = await one(`SELECT "stripeAccountId", status, "disabledReason" FROM "StripeAccount" WHERE "clubId" = 'democlub05'`);
  check(replaced.stripeAccountId !== clubAcct.stripeAccountId && replaced.status === "ONBOARDING" && replaced.disabledReason !== "platform_disconnected", "…and connecting again creates a new Stripe account in its place");

  // 7. A forged Connect webhook ------------------------------------------------------------
  const forged = await fetch(`${APP}/api/webhooks/stripe`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=deadbeef" }, body: JSON.stringify({ type: "account.updated" }) });
  check(forged.status === 400, "a Connect webhook without a valid signature is a 400");
  const forgedThin = await fetch(`${APP}/api/webhooks/stripe`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=deadbeef" }, body: JSON.stringify({ id: "evt_forged", object: "v2.core.event", type: "v2.core.account.closed", related_object: { id: clubAcct.stripeAccountId } }) });
  check(forgedThin.status === 400, "…and so is a forged thin event");

  check(consoleErrors.length === 0, `no browser console errors or warnings${consoleErrors.length ? `:\n  ${[...new Set(consoleErrors)].join("\n  ")}` : ""}`);
} catch (error) {
  failures++;
  console.error(error);
  console.error(appLog.split("\n").slice(-40).join("\n"));
} finally {
  if (process.env.E2E_APP_LOG) (await import("node:fs")).writeFileSync(process.env.E2E_APP_LOG, appLog);
  await db.end();
  await browser.close();
  process.kill(-app.pid, "SIGTERM");
  stripeServer.close();
  smtp.close();
  seed();
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall Stripe Connect e2e checks passed");
process.exit(failures ? 1 : 0);
