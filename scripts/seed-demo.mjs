// npm run db:seed: fills a LOCAL database with demo tenants, subscriptions,
// Stripe Connect accounts, payments, disputes and webhook events, so the
// admin dashboard has something to show.
//
// Safe by construction: refuses to run in production or against a
// non-local database, and only ever touches its own rows (emails ending in
// @demo.nexport.test, ids starting with "demo"), which it replaces on every
// run. It never creates an admin: admins are inserted by hand (see
// docs/admin.md).
import "dotenv/config";

import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed demo data in production");
const host = new URL(url).hostname;
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
  throw new Error(`Refusing to seed a non-local database (${host}). Demo data is for local testing only.`);
}

const client = new pg.Client({ connectionString: url.split("?")[0] });
await client.connect();
const q = (text, params = []) => client.query(text, params);

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const daysAgo = (d, hour = 10) => {
  const date = new Date(now - d * DAY);
  date.setUTCHours(hour, 0, 0, 0);
  return date;
};
const pad = (n) => String(n).padStart(2, "0");

await q("BEGIN");
try {
  // ---- Remove the previous demo data (cascades take care of children) ------
  await q(`DELETE FROM "PaymentTransfer" WHERE id LIKE 'demo%'`);
  await q(`DELETE FROM "PaymentTransaction" WHERE id LIKE 'demo%'`);
  await q(`DELETE FROM "StripeAccount" WHERE id LIKE 'demo%'`);
  await q(`DELETE FROM "Subscription" WHERE id LIKE 'demo%'`);
  await q(`DELETE FROM "PracticeSession" WHERE id LIKE 'demo%'`);
  await q(`DELETE FROM "Club" WHERE id LIKE 'demo%'`);
  await q(`DELETE FROM "User" WHERE email LIKE '%@demo.nexport.test'`);
  await q(`DELETE FROM "StripeWebhookEvent" WHERE id LIKE 'evt_demo%'`);

  // ---- Sports ---------------------------------------------------------------
  for (const [slug, name] of [["padel", "Padel"], ["tennis", "Tennis"], ["football", "Football"]]) {
    await q(`INSERT INTO "Sport"(id, slug, name) VALUES ($1, $2, $3) ON CONFLICT (slug) DO NOTHING`, [`demosport${slug}`, slug, name]);
  }
  const sportId = (await q(`SELECT id FROM "Sport" WHERE slug = 'padel'`)).rows[0].id;

  // ---- People ---------------------------------------------------------------
  const user = async (id, email, name, role, handle, createdAt) => {
    await q(
      `INSERT INTO "User"(id, email, name, role, "emailVerified", "onboardedAt", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $5, $5, $5)`,
      [id, email, name, role, createdAt],
    );
    if (handle) await q(`INSERT INTO "Profile"(id, "userId", handle, "displayName", "updatedAt") VALUES ($1, $2, $3, $4, now())`, [`${id}p`, id, handle, name]);
  };

  const clubs = [
    ["Padel Central", "Valencia", "ACTIVE", "CLUB_ENTERPRISE", "ACTIVE", "healthy", 6],
    ["Ace Tennis Academy", "Madrid", "ACTIVE", "CLUB_BASIC", "ACTIVE", "healthy", 4],
    ["Northside Football", "Barcelona", "ACTIVE", "CLUB_BASIC", "ACTIVE", "healthy", 3],
    ["Smash Padel Lisboa", "Lisbon", "ACTIVE", "CLUB_BASIC", "PAST_DUE", "restricted", 4],
    ["Riverside Racquets", "Seville", "ACTIVE", "CLUB_BASIC", "TRIALING", "onboarding", 2],
    ["Summit Multi-Sport", "Bilbao", "PENDING_SETUP", null, null, null, 0],
  ];
  const clubIds = [];
  for (const [i, [name, city, status, tier, subStatus, connect, facilities]] of clubs.entries()) {
    const n = pad(i + 1);
    const ownerId = `demoowner${n}`;
    const clubId = `democlub${n}`;
    clubIds.push(clubId);
    await user(ownerId, `owner${n}@demo.nexport.test`, `${name} Owner`, "CLUB_OWNER", `owner${n}.demo`, daysAgo(120 - i * 18));
    await q(
      `INSERT INTO "Club"(id, slug, name, city, country, status, "ownerId", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 'ES', $5, $6, $7, now())`,
      [clubId, `demo-${name.toLowerCase().replace(/[^a-z]+/g, "-").replace(/-$/, "")}`, name, city, status, ownerId, daysAgo(120 - i * 18)],
    );
    await q(`INSERT INTO "ClubMember"(id, "clubId", "userId", role, status, "joinedAt", "updatedAt") VALUES ($1, $2, $3, 'OWNER', 'ACTIVE', now(), now())`, [`demomember${n}`, clubId, ownerId]);
    for (let f = 1; f <= facilities; f++) {
      await q(`INSERT INTO "Facility"(id, "clubId", name, type, "updatedAt") VALUES ($1, $2, $3, 'PADEL_COURT', now())`, [`demofac${n}${f}`, clubId, `Court ${f}`]);
    }
    if (tier) {
      const amount = tier === "CLUB_ENTERPRISE" ? 14900 : 4900;
      await q(
        `INSERT INTO "Subscription"(id, "clubId", tier, status, "stripeCustomerId", "stripeSubscriptionId", "stripePriceId", "monthlyAmount",
           "platformFeeBps", "currentPeriodStart", "currentPeriodEnd", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now() - interval '10 days', now() + interval '20 days', $10, now())`,
        [`demosub${n}`, clubId, tier, subStatus, `cus_demo${n}`, `sub_demo${n}`, `price_demo${tier.toLowerCase().replace("_", "")}`, amount, tier === "CLUB_ENTERPRISE" ? 300 : 600, daysAgo(100 - i * 15)],
      );
    }
    if (connect) {
      const healthy = connect === "healthy";
      await q(
        `INSERT INTO "StripeAccount"(id, "clubId", "stripeAccountId", status, country, "defaultCurrency", "chargesEnabled", "payoutsEnabled",
           "detailsSubmitted", "requirementsDue", "disabledReason", "updatedAt")
         VALUES ($1, $2, $3, $4, 'ES', 'eur', $5, $6, $7, $8, $9, now())`,
        [
          `demoacct${n}`,
          clubId,
          `acct_demo${n}`,
          healthy ? "ACTIVE" : connect === "restricted" ? "RESTRICTED" : "ONBOARDING",
          healthy || connect === "restricted",
          healthy,
          connect !== "onboarding",
          connect === "restricted" ? ["individual.verification.document", "external_account"] : [],
          connect === "restricted" ? "requirements.past_due" : null,
        ],
      );
    }
  }

  const coaches = [
    ["Lucía Romero", "PRO_COACH", "ACTIVE", true],
    ["Tom Becker", "PRO_COACH", "ACTIVE", true],
    ["Aisha Diallo", null, null, false],
    ["Marco Rossi", "PRO_COACH", "CANCELED", false],
    ["Sofia Nilsson", null, null, false],
  ];
  const coachIds = [];
  for (const [i, [name, tier, subStatus, connected]] of coaches.entries()) {
    const n = pad(i + 1);
    const id = `democoach${n}`;
    coachIds.push(id);
    await user(id, `coach${n}@demo.nexport.test`, name, "COACH", `coach${n}.demo`, daysAgo(90 - i * 14));
    if (tier) {
      await q(
        `INSERT INTO "Subscription"(id, "userId", tier, status, "stripeCustomerId", "stripeSubscriptionId", "stripePriceId", "monthlyAmount",
           "platformFeeBps", "currentPeriodStart", "currentPeriodEnd", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, 'price_demoprocoach', 2900, 500, now() - interval '5 days', now() + interval '25 days', $7, now())`,
        [`demosubc${n}`, id, tier, subStatus, `cus_democ${n}`, `sub_democ${n}`, daysAgo(80 - i * 12)],
      );
    }
    if (connected) {
      await q(
        `INSERT INTO "StripeAccount"(id, "userId", "stripeAccountId", status, country, "defaultCurrency", "chargesEnabled", "payoutsEnabled", "detailsSubmitted", "updatedAt")
         VALUES ($1, $2, $3, 'ACTIVE', 'ES', 'eur', true, true, true, now())`,
        [`demoacctc${n}`, id, `acct_democ${n}`],
      );
    }
  }

  const athletes = [];
  for (let a = 1; a <= 6; a++) {
    const id = `demoathlete${pad(a)}`;
    athletes.push(id);
    await user(id, `athlete${pad(a)}@demo.nexport.test`, `Demo Athlete ${a}`, "STUDENT", `athlete${pad(a)}.demo`, daysAgo(60 - a));
  }

  // ---- Sessions and payments (first four clubs) -----------------------------
  let p = 0;
  for (const [ci, clubId] of clubIds.slice(0, 4).entries()) {
    const n = pad(ci + 1);
    const coachId = coachIds[ci % 2];
    for (let s = 1; s <= 3; s++) {
      const sessionId = `demosess${n}${s}`;
      const starts = daysAgo(s * 7 + ci, 9 + s);
      await q(
        `INSERT INTO "PracticeSession"(id, "clubId", "facilityId", "coachId", "sportId", "createdById", title, "startsAt", "endsAt",
           status, "priceAmount", "coachShareBps", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $4, $6, $7, $8, 'SCHEDULED', 2400, 7000, now())`,
        [sessionId, clubId, `demofac${n}1`, coachId, sportId, `Demo clinic ${s}`, starts, new Date(starts.getTime() + 90 * 60 * 1000)],
      );
      for (const athleteId of athletes.slice(s, s + 2)) {
        p++;
        const pn = pad(p);
        const participantId = `demopart${pn}`;
        await q(`INSERT INTO "SessionParticipant"(id, "sessionId", "userId", status, "updatedAt") VALUES ($1, $2, $3, 'ACCEPTED', now())`, [participantId, sessionId, athleteId]);
        const amount = 2400;
        const fee = ci === 0 ? 72 : 144; // 3% enterprise rake, 6% basic
        const dispute = p === 3 ? "NEEDS_RESPONSE" : p === 9 ? "WON" : "NONE";
        const refunded = p === 5 ? 2400 : 0;
        await q(
          `INSERT INTO "PaymentTransaction"(id, "clubId", "sessionId", "participantId", "payerId", "coachId", amount, currency, "applicationFeeAmount",
             "stripeFeeAmount", status, "stripePaymentIntentId", "stripeChargeId", "transferGroup", "idempotencyKey", "refundStatus", "refundedAmount",
             "refundedAt", "disputeStatus", "stripeDisputeId", "disputedAmount", "disputeReason", "paidAt", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'eur', $8, 61, 'SUCCEEDED', $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $20, now())`,
          [
            `demopay${pn}`, clubId, sessionId, participantId, athleteId, coachId, amount, fee,
            `pi_demo${pn}`, `ch_demo${pn}`, `group_demo${pn}`, `idem_demo${pn}`,
            refunded ? "REFUNDED" : "NONE", refunded, refunded ? new Date(now - 2 * DAY) : null,
            dispute, dispute === "NONE" ? null : `dp_demo${pn}`, dispute === "NONE" ? null : amount,
            dispute === "NONE" ? null : dispute === "WON" ? "product_not_received" : "fraudulent", starts,
          ],
        );
        const transferStatus = p === 7 ? "FAILED" : p % 4 === 0 ? "PENDING" : "PAID";
        const clubAccount = ci === 3 ? null : `demoacct${n}`;
        if (clubAccount) {
          await q(
            `INSERT INTO "PaymentTransfer"(id, "paymentId", "stripeAccountId", "recipientType", amount, currency, status, "stripeTransferId", "updatedAt")
             VALUES ($1, $2, $3, 'CLUB', $4, 'eur', $5, $6, now())`,
            [`demotr${pn}`, `demopay${pn}`, clubAccount, amount - fee - 61, transferStatus, transferStatus === "PENDING" ? null : `tr_demo${pn}`],
          );
        }
      }
      // Participants join while the session is scheduled; it completes afterwards
      // (the seat-capacity guard rejects joining a completed session).
      await q(`UPDATE "PracticeSession" SET status = 'COMPLETED' WHERE id = $1`, [sessionId]);
    }
  }

  // ---- Stripe webhook events -------------------------------------------------
  const events = [
    ["payment_intent.succeeded", null, true],
    ["charge.dispute.created", null, true],
    ["account.updated", null, true],
    ["customer.subscription.updated", null, true],
    ["invoice.payment_failed", null, true],
    ["transfer.failed", "No such destination: acct_demo04", false],
    ["payout.paid", null, true],
    ["checkout.session.completed", null, null],
  ];
  for (const [i, [type, error, processed]] of events.entries()) {
    await q(
      `INSERT INTO "StripeWebhookEvent"(id, type, livemode, "processedAt", error, "createdAt") VALUES ($1, $2, false, $3, $4, $5)`,
      [`evt_demo${pad(i + 1)}`, type, processed ? new Date(now - i * 3600 * 1000) : null, error, new Date(now - i * 3600 * 1000)],
    );
  }

  await q("COMMIT");
} catch (error) {
  await q("ROLLBACK");
  throw error;
} finally {
  await client.end();
}

console.log("Demo data ready: 6 clubs, 5 independent coaches, 6 athletes, payments, disputes and webhook events.");
console.log("Admins aren't seeded; see docs/admin.md to create yours.");
