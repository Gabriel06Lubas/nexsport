// npm run db:seed: fills a LOCAL database with demo tenants, subscriptions,
// Stripe Connect accounts, payments, disputes and webhook events, so the
// admin dashboard has something to show, and gives the first club ("Padel
// Central") a full operation for the club dashboard: dynamic pricing, four
// weeks of court rentals, coached sessions split through Stripe Connect,
// memberships, staff and equipment; and gives its head coach (Lucía Romero)
// private lessons, open matches, attendance and a public booking page.
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
  // Rows that reference their parent with ON DELETE RESTRICT go first.
  await q(`DELETE FROM "FacilityBooking" WHERE "clubId" LIKE 'demo%'`);
  await q(`DELETE FROM "MemberPass" WHERE "clubId" LIKE 'demo%'`);
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
      `INSERT INTO "Club"(id, slug, name, city, country, timezone, status, "ownerId", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 'ES', $8, $5, $6, $7, now())`,
      [clubId, `demo-${name.toLowerCase().replace(/[^a-z]+/g, "-").replace(/-$/, "")}`, name, city, status, ownerId, daysAgo(120 - i * 18), city === "Lisbon" ? "Europe/Lisbon" : "Europe/Madrid"],
    );
    await q(`INSERT INTO "ClubMember"(id, "clubId", "userId", role, status, "joinedAt", "updatedAt") VALUES ($1, $2, $3, 'OWNER', 'ACTIVE', now(), now())`, [`demomember${n}`, clubId, ownerId]);
    for (let f = 1; f <= facilities; f++) {
      await q(
        `INSERT INTO "Facility"(id, "clubId", name, type, surface, "isIndoor", "hasLighting", capacity, "hourlyRateAmount", "updatedAt")
         VALUES ($1, $2, $3, 'PADEL_COURT', 'SYNTHETIC', $4, true, 4, 2400, now())`,
        [`demofac${n}${f}`, clubId, i === 0 ? `Padel Glass Court ${f}` : `Court ${f}`, f <= 4],
      );
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

  // ---- Club dashboard: Padel Central (democlub01) ---------------------------
  // Times below are local to the club (Europe/Madrid): `local(day, minute)`
  // is `minute` after midnight, `day` days from today, as an instant.
  {
    const clubId = "democlub01";
    const TZ = "Europe/Madrid";
    const parts = (instant) => {
      const p = Object.fromEntries(
        new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short" })
          .formatToParts(instant)
          .map((x) => [x.type, x.value]),
      );
      return { ...p, dow: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(p.weekday) + 1 };
    };
    const today = parts(new Date());
    const local = (dayOffset, minute) => {
      const naive = Date.UTC(Number(today.year), Number(today.month) - 1, Number(today.day) + dayOffset, 0, minute);
      const offset = (t) => {
        const p = parts(new Date(t));
        return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute)) - t;
      };
      const guess = naive - offset(naive);
      return new Date(naive - offset(guess));
    };
    const dowOf = (dayOffset) => parts(local(dayOffset, 720)).dow;
    const HISTORY = 150; // days of rentals and clinics
    // Deterministic pseudo-random numbers, so every seed looks the same.
    let state = 20261030;
    const rand = () => ((state = (state * 1103515245 + 12345) % 2147483648) / 2147483648);

    // Dynamic pricing on every court: weekday evenings peak, mornings off-peak, weekend peak.
    for (let f = 1; f <= 6; f++) {
      for (let d = 1; d <= 7; d++) {
        const rules = d <= 5 ? [[1080, 1320, "PEAK", 3200], [480, 720, "OFF_PEAK", 1600]] : [[540, 840, "PEAK", 3000]];
        for (const [start, end, tier, rate] of rules) {
          await q(
            `INSERT INTO "FacilityPriceRule"(id, "clubId", "facilityId", "dayOfWeek", "startMinute", "endMinute", tier, "hourlyRateAmount", "updatedAt")
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())`,
            [`demorule${f}${d}${start}`, clubId, `demofac01${f}`, d, start, end, tier, rate],
          );
        }
      }
    }

    // Team: a front-desk staff member with limited permissions, an employed
    // club coach, and the two independent coaches working freelance here.
    await user("demostaff01", "staff01@demo.nexport.test", "Nora Front Desk", "STAFF", "staff01.demo", daysAgo(100));
    await user("demostaff02", "staff02@demo.nexport.test", "Pablo Ruiz", "STAFF", "staff02.demo", daysAgo(95));
    const member = (id, userId, role, extra = {}) =>
      q(
        `INSERT INTO "ClubMember"(id, "clubId", "userId", role, status, title, "employmentType", "hourlyWageAmount", "commissionBps", permissions, "joinedAt", "updatedAt")
         VALUES ($1, $2, $3, $4, 'ACTIVE', $5, $6, $7, $8, $9::"ClubPermission"[], $10, now())`,
        [id, clubId, userId, role, extra.title ?? null, extra.employment ?? null, extra.wage ?? null, extra.commission ?? null, extra.permissions ?? [], extra.joinedAt ?? daysAgo(90)],
      );
    await member("demomemberstaff01", "demostaff01", "STAFF", { title: "Front Desk", employment: "EMPLOYEE", wage: 1400, permissions: ["MANAGE_SCHEDULE", "MANAGE_MEMBERS"] });
    await member("demomembercoachs2", "demostaff02", "COACH", { title: "Club Coach", employment: "EMPLOYEE", wage: 1800 });
    await member("demomembercoach01", "democoach01", "COACH", { title: "Head Coach", employment: "FREELANCE", commission: 7000 });
    await member("demomembercoach02", "democoach02", "COACH", { title: "Padel Coach", employment: "FREELANCE", commission: 6500 });
    for (const [a, athleteId] of athletes.entries()) {
      await member(`demomemberath${pad(a + 1)}`, athleteId, "STUDENT", { joinedAt: daysAgo(a < 2 ? 10 + a : 70 - a * 5) });
    }

    // Equipment and its maintenance log.
    const items = [
      ["demoeqrackets", "Rental padel rackets", "Rackets", 24, "GOOD"],
      ["demoeqballs", "Padel ball tubes", "Balls", 60, "NEW"],
      ["demoeqmachine", "Ball machine", "Machines", 1, "NEEDS_REPAIR"],
      ["demoeqcones", "Training cones", "Training", 40, "FAIR"],
    ];
    for (const [id, name, category, quantity, condition] of items) {
      await q(`INSERT INTO "Equipment"(id, "clubId", name, category, quantity, condition, "updatedAt") VALUES ($1, $2, $3, $4, $5, $6, now())`, [id, clubId, name, category, quantity, condition]);
    }
    const repairs = [
      ["demomaint1", "demoeqrackets", 3, "Cracked frames", 6, null],
      ["demomaint2", "demoeqmachine", 1, "Feeder motor fault", 3, null],
      ["demomaint3", "demoeqrackets", 2, "Grips replaced", 20, 17],
    ];
    for (const [id, equipmentId, quantity, reason, startedDaysAgo, resolvedDaysAgo] of repairs) {
      await q(
        `INSERT INTO "EquipmentMaintenance"(id, "clubId", "equipmentId", quantity, reason, "reportedById", "startedAt", "resolvedAt", "resolvedById", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, 'demostaff01', $6, $7, $8, now())`,
        [id, clubId, equipmentId, quantity, reason, daysAgo(startedDaysAgo), resolvedDaysAgo === null ? null : daysAgo(resolvedDaysAgo), resolvedDaysAgo === null ? null : "demostaff01"],
      );
    }

    // Online payment with its Connect transfers (club share, and the coach's for sessions).
    let pay = 0;
    const onlinePayment = async ({ kind, target, payerId, amount, paidAt, coachId = null, coachShareBps = 0, participantId = null }) => {
      pay++;
      const id = `demopayc${String(pay).padStart(3, "0")}`;
      const platformFee = Math.round((amount * 300) / 10000); // Club Enterprise: 3%
      const processing = Math.round(amount * 0.015) + 25;
      const net = amount - platformFee - processing;
      const coachAmount = Math.floor((net * coachShareBps) / 10000);
      const column = { SESSION: "sessionId", COURT_RENTAL: "facilityBookingId", MEMBERSHIP: "memberPassId" }[kind];
      await q(
        `INSERT INTO "PaymentTransaction"(id, "clubId", kind, "${column}", "participantId", "payerId", "coachId", amount, currency, "applicationFeeAmount",
           "stripeFeeAmount", status, "stripePaymentIntentId", "stripeChargeId", "transferGroup", "idempotencyKey", "paidAt", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'eur', $9, $10, 'SUCCEEDED', $11, $12, $13, $14, $15, $15, now())`,
        [id, clubId, kind, target, participantId, payerId, coachId, amount, platformFee, processing, `pi_${id}`, `ch_${id}`, `group_${id}`, `idem_${id}`, paidAt],
      );
      const settled = Date.now() - new Date(paidAt).getTime() > 2 * DAY;
      await q(
        `INSERT INTO "PaymentTransfer"(id, "paymentId", "stripeAccountId", "recipientType", amount, currency, status, "stripeTransferId", "updatedAt")
         VALUES ($1, $2, 'demoacct01', 'CLUB', $3, 'eur', $4, $5, now())`,
        [`${id}c`, id, net - coachAmount, settled ? "PAID" : "PENDING", settled ? `tr_${id}c` : null],
      );
      if (coachAmount > 0) {
        const account = coachId === "democoach01" ? "demoacctc01" : "demoacctc02";
        await q(
          `INSERT INTO "PaymentTransfer"(id, "paymentId", "stripeAccountId", "recipientType", amount, currency, status, "stripeTransferId", "updatedAt")
           VALUES ($1, $2, $3, 'COACH', $4, 'eur', $5, $6, now())`,
          [`${id}k`, id, account, coachAmount, settled ? "PAID" : "PENDING", settled ? `tr_${id}k` : null],
        );
      }
    };

    // Coached sessions on court 1, every other weekday 08:00-09:30, over the
    // last five months (completed) and the next week (scheduled).
    let sessionNo = 0;
    for (let d = -HISTORY; d <= 7; d++) {
      const dow = dowOf(d);
      if (dow > 5 || d % 2 !== 0) continue;
      sessionNo++;
      const sessionId = `democlinic${String(sessionNo).padStart(3, "0")}`;
      const coachId = ["democoach01", "demostaff02", "democoach02"][sessionNo % 3];
      const share = coachId === "democoach01" ? 7000 : coachId === "democoach02" ? 6500 : 0;
      const startsAt = local(d, 480);
      const endsAt = local(d, 570);
      await q(
        `INSERT INTO "PracticeSession"(id, "clubId", "facilityId", "coachId", "sportId", "createdById", title, kind, "startsAt", "endsAt", status,
           "maxParticipants", "priceAmount", "coachShareBps", "updatedAt")
         VALUES ($1, $2, 'demofac011', $3, $4, 'demoowner01', $5, $9, $6, $7, 'SCHEDULED', 4, 2500, $8, now())`,
        [sessionId, clubId, coachId, sportId, ["Morning clinic", "Technique drills", "Match play"][sessionNo % 3], startsAt, endsAt, share, sessionNo % 3 === 2 ? "OPEN_MATCH" : "GROUP"],
      );
      if (d >= 0) continue;
      for (const athleteId of athletes.slice(sessionNo % 3, (sessionNo % 3) + 2 + (sessionNo % 2))) {
        const participantId = `${sessionId}${athleteId.slice(-2)}`;
        await q(`INSERT INTO "SessionParticipant"(id, "sessionId", "userId", status, "updatedAt") VALUES ($1, $2, $3, 'ACCEPTED', now())`, [participantId, sessionId, athleteId]);
        await onlinePayment({ kind: "SESSION", target: sessionId, participantId, payerId: athleteId, amount: 2500, paidAt: startsAt, coachId, coachShareBps: share });
      }
      await q(`UPDATE "PracticeSession" SET status = 'COMPLETED' WHERE id = $1`, [sessionId]);
    }

    // Coach dashboard: Lucía Romero (democoach01), freelance at Padel Central.
    // Private lessons Tue/Thu 10:00-11:00 on court 1 (clinics end at 09:30 and
    // court 1 is only rented from 17:00), and open matches on alternate
    // Saturdays at noon. Past ones are paid and completed, except the most
    // recent private lesson, left for her to wrap up.
    {
      let lessonNo = 0;
      const lastPast = (() => {
        for (let d = -1; d >= -7; d--) if ([2, 4].includes(dowOf(d))) return d;
        return -1;
      })();
      for (let d = -60; d <= 14; d++) {
        const dow = dowOf(d);
        const lesson = dow === 2 || dow === 4;
        const match = dow === 6 && Math.abs(d) % 14 < 7;
        if (!lesson && !match) continue;
        lessonNo++;
        const id = `demolesson${String(lessonNo).padStart(3, "0")}`;
        const startsAt = local(d, lesson ? 600 : 720);
        const endsAt = local(d, lesson ? 660 : 810);
        const players = lesson ? [athletes[lessonNo % 3]] : athletes.slice(lessonNo % 3, (lessonNo % 3) + 4);
        const price = lesson ? 4000 : 1500;
        await q(
          `INSERT INTO "PracticeSession"(id, "clubId", "facilityId", "coachId", "sportId", "createdById", title, kind, "startsAt", "endsAt", status,
             "maxParticipants", "priceAmount", "coachShareBps", "updatedAt")
           VALUES ($1, $2, 'demofac011', 'democoach01', $3, 'democoach01', $4, $5, $6, $7, 'SCHEDULED', $8, $9, 7000, now())`,
          [id, clubId, sportId, lesson ? "Private lesson" : "Saturday open match", lesson ? "PRIVATE" : "OPEN_MATCH", startsAt, endsAt, lesson ? 1 : 4, price],
        );
        for (const athleteId of players) {
          const participantId = `${id}${athleteId.slice(-2)}`;
          await q(`INSERT INTO "SessionParticipant"(id, "sessionId", "userId", status, "updatedAt") VALUES ($1, $2, $3, 'ACCEPTED', now())`, [participantId, id, athleteId]);
          if (d < 0) await onlinePayment({ kind: "SESSION", target: id, participantId, payerId: athleteId, amount: price, paidAt: startsAt, coachId: "democoach01", coachShareBps: 7000 });
        }
        if (d < 0 && d !== lastPast) await q(`UPDATE "PracticeSession" SET status = 'COMPLETED' WHERE id = $1`, [id]);
      }

      await q(
        `INSERT INTO "CoachProfile"("userId", slug, headline, bio, "bookingEnabled", timezone, "sportId", "privateRateAmount", "groupRateAmount",
           "sessionMinutes", "minNoticeHours", "maxAdvanceDays", "updatedAt")
         VALUES ('democoach01', 'lucia-romero', 'Padel coach · ex-pro, 12 years teaching', $1, true, 'Europe/Madrid', $2, 4000, 2000, 60, 12, 21, now())`,
        ["I coach players from first lessons to tournament level: footwork, the bandeja and smart positioning.", sportId],
      );
      const windows = [
        [2, 1020, 1200, null],
        [4, 1020, 1200, null],
        [6, 600, 720, "demofac012"],
      ];
      for (const [i, [day, start, end, facility]] of windows.entries()) {
        await q(
          `INSERT INTO "CoachAvailability"(id, "coachId", "clubId", "facilityId", "dayOfWeek", "startMinute", "endMinute", "updatedAt")
           VALUES ($1, 'democoach01', $2, $3, $4, $5, $6, now())`,
          [`demoavail${i + 1}`, clubId, facility, day, start, end],
        );
      }
      // The club assigned her three students.
      for (const a of [1, 2, 3]) {
        await q(
          `INSERT INTO "CoachAssignment"(id, "clubId", "coachMemberId", "studentMemberId", "sportId", "startsOn") VALUES ($1, $2, 'demomembercoach01', $3, $4, current_date - 60)`,
          [`demoassign${a}`, clubId, `demomemberath${pad(a)}`, sportId],
        );
      }
    }

    // Attendance on every completed session at the club: mostly present.
    await q(
      `INSERT INTO "Attendance"(id, "sessionId", "participantId", "userId", status, "checkedInAt", "markedById", "updatedAt")
       SELECT 'demoatt' || p.id, s.id, p.id, p."userId", x.status::"AttendanceStatus",
              CASE WHEN x.status = 'ABSENT' THEN NULL ELSE s."startsAt" END, s."coachId", now()
         FROM "SessionParticipant" p
         JOIN "PracticeSession" s ON s.id = p."sessionId"
         CROSS JOIN LATERAL (SELECT CASE WHEN abs(hashtext(p.id)) % 100 < 7 THEN 'ABSENT' WHEN abs(hashtext(p.id)) % 100 < 15 THEN 'LATE' ELSE 'PRESENT' END AS status) x
        WHERE s."clubId" = $1 AND s.status = 'COMPLETED' AND p.status = 'ACCEPTED'`,
      [clubId],
    );

    // Court rentals: 90-minute slots, busiest on weekday evenings and weekend
    // mornings. Court 1 is only rented from 17:00 (mornings are clinics).
    // Old rentals are paid at the desk; online booking started a month ago.
    const priceAt = (dow, minute) => {
      if (dow <= 5 && minute >= 1080 && minute < 1320) return 3200;
      if (dow <= 5 && minute >= 480 && minute < 720) return 1600;
      if (dow > 5 && minute >= 540 && minute < 840) return 3000;
      return 2400;
    };
    let booking = 0;
    for (let d = -HISTORY; d <= 6; d++) {
      const dow = dowOf(d);
      // The club grew over the season: older months are quieter.
      const growth = d >= -28 ? 1 : 0.45 + 0.55 * (1 - (-d - 28) / (HISTORY - 28));
      for (let f = 1; f <= 6; f++) {
        for (let start = f === 1 ? 1020 : 480; start + 90 <= 1380; start += 90) {
          const evening = start >= 1080;
          const chance = dow > 5 ? (start < 840 ? 0.75 : 0.45) : evening ? 0.8 : start < 720 ? 0.3 : 0.2;
          if (rand() > chance * growth * (d > 0 ? 0.6 : 1)) continue;
          booking++;
          const id = `demobook${String(booking).padStart(4, "0")}`;
          // Price per 15-minute slot at the window it starts in (as the app does).
          let price = 0;
          for (let m = start; m < start + 90; m += 15) price += priceAt(dow, m) / 4;
          const startsAt = local(d, start);
          const endsAt = local(d, start + 90);
          const online = d >= -35 && rand() < 0.35;
          const customer = online || rand() < 0.4 ? athletes[booking % athletes.length] : null;
          const past = d < 0;
          await q(
            `INSERT INTO "FacilityBooking"(id, "clubId", "facilityId", "customerId", "customerName", "bookedById", "startsAt", "endsAt", "priceAmount",
               "paymentMethod", "paidAt", "updatedAt")
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())`,
            [
              id, clubId, `demofac01${f}`, customer, customer ? null : ["Walk-in · Marta", "Walk-in · Javi", "Walk-in · Lea", "Walk-in · Omar"][booking % 4],
              online ? null : "demostaff01", startsAt, endsAt, price, online ? "ONLINE" : "ON_SITE", online || past ? startsAt : null,
            ],
          );
          if (online) await onlinePayment({ kind: "COURT_RENTAL", target: id, payerId: customer, amount: price, paidAt: past ? startsAt : new Date(now - DAY) });
        }
      }
    }

    // Membership plans and passes.
    const plans = [
      ["demoplanunl", "Monthly Unlimited", "UNLIMITED", 6900, 30, null, true, "Unlimited court bookings at off-peak times and every clinic."],
      ["demoplan10", "10-Session Punch Card", "CREDITS", 9000, 90, 10, true, "Ten coached sessions, valid for three months."],
      ["demoplansummer", "Summer Pass", "UNLIMITED", 4900, 60, null, false, null],
    ];
    for (const [id, name, kind, price, days, credits, active, description] of plans) {
      await q(
        `INSERT INTO "MembershipPlan"(id, "clubId", name, description, kind, "priceAmount", "durationDays", "creditCount", "isActive", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())`,
        [id, clubId, name, description, kind, price, days, credits, active],
      );
    }
    const passes = [
      // [id, plan, athlete index, started days ago, credits used, payment, cancelled]
      ["demopass1", "demoplanunl", 0, 12, 0, "ONLINE", false],
      ["demopass2", "demoplan10", 1, 20, 4, "ON_SITE", false],
      ["demopass3", "demoplan10", 2, 80, 9, "ON_SITE", false], // one credit left, expiring soon
      ["demopass4", "demoplanunl", 3, 25, 0, "ON_SITE", false], // expires within the week
      ["demopass5", "demoplan10", 4, 40, 10, "ONLINE", false], // used up
      ["demopass6", "demoplansummer", 5, 75, 0, "ON_SITE", false], // expired
      ["demopass7", "demoplanunl", 5, 5, 0, "COMPLIMENTARY", true], // cancelled
      ["demopass8", "demoplanunl", 1, 40, 0, "ON_SITE", false], // last month's, expired
    ];
    for (const [id, planId, a, started, used, method, cancelled] of passes) {
      const plan = plans.find((p) => p[0] === planId);
      const startsAt = daysAgo(started, 9);
      const expiresAt = new Date(startsAt.getTime() + plan[4] * DAY);
      await q(
        `INSERT INTO "MemberPass"(id, "clubId", "planId", "userId", "creditsTotal", "creditsUsed", "startsAt", "expiresAt", "priceAmount", currency,
           "paymentMethod", "paidAt", "soldById", "cancelledAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'eur', $10, $11, $12, $13, now())`,
        [id, clubId, planId, athletes[a], plan[5], used, startsAt, expiresAt, plan[3], method, method === "COMPLIMENTARY" ? null : startsAt, method === "ONLINE" ? null : "demostaff01", cancelled ? daysAgo(1) : null],
      );
      if (method === "ONLINE") await onlinePayment({ kind: "MEMBERSHIP", target: id, payerId: athletes[a], amount: plan[3], paidAt: startsAt });
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
console.log("Club dashboard: sign in as owner01@demo.nexport.test (Padel Central) or staff01@demo.nexport.test (front desk).");
console.log("Coach dashboard: sign in as coach01@demo.nexport.test (booking page: /coach/lucia-romero).");
console.log("Admins aren't seeded; see docs/admin.md to create yours.");
