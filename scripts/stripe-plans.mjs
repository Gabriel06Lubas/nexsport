// npm run stripe:plans: connects the SaaS plans in src/config/plans.json to
// Stripe Products and Prices.
//
//   npm run stripe:plans -- --create   Create (or reuse) a Product and a monthly
//                                      Price per paid plan in Stripe, then print
//                                      the STRIPE_PRICE_* lines for .env.
//                                      Test-mode keys only, unless --live.
//   npm run stripe:plans               Check each STRIPE_PRICE_* Price against
//                                      plans.json (amount, currency, monthly,
//                                      active), then store it on the plan in the
//                                      database and make the plan available.
//
// A Price that doesn't match is refused, not stored: a plan sold at a
// different price than the pricing page shows is the bug this prevents.
import "dotenv/config";

import pg from "pg";
import Stripe from "stripe";

import plansFile from "../src/config/plans.json" with { type: "json" };

const args = new Set(process.argv.slice(2));
const key = process.env.STRIPE_SECRET_KEY?.trim();
if (!key) fail("STRIPE_SECRET_KEY is not set (see .env.example).");
const base = process.env.NODE_ENV !== "production" && process.env.STRIPE_API_BASE ? new URL(process.env.STRIPE_API_BASE) : null;
const stripe = new Stripe(key, {
  appInfo: { name: "nexport-plans" },
  ...(base ? { host: base.hostname, port: base.port, protocol: base.protocol === "http:" ? "http" : "https" } : {}),
});
const currency = plansFile.currency;
const paid = plansFile.plans.filter((p) => p.stripePriceEnv);
const lookupKey = (tier) => `nexport_${tier.toLowerCase()}_monthly`;
const money = (amount) => `${(amount / 100).toFixed(2)} ${currency.toUpperCase()}`;

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (args.has("--create")) {
  if (!key.startsWith("sk_test_") && !key.startsWith("rk_test_") && !args.has("--live")) {
    fail("Refusing to create Products with a live key. Use a test-mode key, or add --live if you really mean it.");
  }
  const lines = [];
  for (const plan of paid) {
    const productId = `nexport_${plan.tier.toLowerCase()}`;
    const product = await stripe.products.retrieve(productId).catch(async (error) => {
      if (error?.statusCode !== 404) throw error;
      return stripe.products.create({ id: productId, name: `nexport ${plan.name}`, metadata: { tier: plan.tier } }, { idempotencyKey: `product-${productId}` });
    });
    // Reuse the current Price if it already matches; otherwise create one and
    // move the lookup key to it (the old Price keeps billing existing customers).
    const existing = (await stripe.prices.list({ lookup_keys: [lookupKey(plan.tier)], active: true, limit: 1 })).data[0];
    const matches = existing && existing.unit_amount === plan.monthlyPriceAmount && existing.currency === currency && existing.recurring?.interval === "month";
    const price = matches
      ? existing
      : await stripe.prices.create(
          {
            product: product.id,
            unit_amount: plan.monthlyPriceAmount,
            currency,
            recurring: { interval: "month" },
            lookup_key: lookupKey(plan.tier),
            transfer_lookup_key: true,
            nickname: `${plan.name} monthly`,
            metadata: { tier: plan.tier },
          },
          { idempotencyKey: `price-${plan.tier}-${plan.monthlyPriceAmount}-${currency}` },
        );
    console.log(`${plan.name}: ${matches ? "reusing" : "created"} ${price.id} (${money(plan.monthlyPriceAmount)}/month) on ${product.id}`);
    lines.push(`${plan.stripePriceEnv}="${price.id}"`);
  }
  console.log(`\nAdd to .env, then run \`npm run stripe:plans\` to store them on the plans:\n\n${lines.join("\n")}`);
  process.exit(0);
}

// Sync: check every configured Price, then store the matching ones.
const url = process.env.DATABASE_URL;
if (!url) fail("DATABASE_URL is not set.");
const problems = [];
const verified = [];
const rejected = [];
for (const plan of paid) {
  const priceId = process.env[plan.stripePriceEnv]?.trim();
  if (!priceId) {
    console.log(`${plan.name}: ${plan.stripePriceEnv} not set; plan left as it is (a paid plan needs a Price to be available).`);
    continue;
  }
  if (!/^price_[A-Za-z0-9]{8,64}$/.test(priceId)) {
    problems.push(`${plan.stripePriceEnv}: "${priceId}" doesn't look like a Stripe Price ID (price_…).`);
    continue;
  }
  const price = await stripe.prices.retrieve(priceId).catch((error) => {
    problems.push(`${plan.stripePriceEnv}: ${priceId} not found in this Stripe account (${error?.message ?? error}).`);
    return null;
  });
  if (!price) continue;
  const mismatch = [
    !price.active && "the Price is archived",
    price.type !== "recurring" && "it isn't a recurring Price",
    price.recurring && (price.recurring.interval !== "month" || price.recurring.interval_count !== 1) && `it bills every ${price.recurring.interval_count} ${price.recurring.interval}, not monthly`,
    price.currency !== currency && `its currency is ${price.currency.toUpperCase()}, the plan's is ${currency.toUpperCase()}`,
    price.unit_amount !== plan.monthlyPriceAmount && `it charges ${money(price.unit_amount ?? 0)}, the plan costs ${money(plan.monthlyPriceAmount)}`,
  ].filter(Boolean);
  if (mismatch.length) {
    problems.push(`${plan.name} (${plan.stripePriceEnv}=${priceId}): ${mismatch.join("; ")}.`);
    rejected.push(plan);
  } else verified.push({ plan, priceId });
}

const client = new pg.Client({ connectionString: url.split("?")[0] });
await client.connect();
try {
  await client.query("BEGIN");
  for (const plan of plansFile.plans) {
    // Keep the database's prices, fees and limits identical to plans.json.
    await client.query(
      `UPDATE "SubscriptionPlan" SET name = $2, "monthlyPriceAmount" = $3, currency = $4, "platformFeeBps" = $5,
              "maxFacilities" = $6, "maxStaff" = $7, "maxAthletes" = $8, "updatedAt" = now()
        WHERE tier = $1`,
      [plan.tier, plan.name, plan.monthlyPriceAmount, currency, plan.platformFeeBps, plan.limits.maxFacilities, plan.limits.maxStaff, plan.limits.maxAthletes],
    );
  }
  await client.query(`UPDATE "SubscriptionPlan" SET "isActive" = true WHERE "monthlyPriceAmount" = 0`);
  // A configured Price that no longer matches the plan: stop selling the plan
  // until it's fixed, rather than charge something the pricing page doesn't say.
  for (const plan of rejected) {
    await client.query(`UPDATE "SubscriptionPlan" SET "isActive" = false, "updatedAt" = now() WHERE tier = $1`, [plan.tier]);
  }
  for (const { plan, priceId } of verified) {
    await client.query(`UPDATE "SubscriptionPlan" SET "stripePriceId" = $2, "isActive" = true, "updatedAt" = now() WHERE tier = $1`, [plan.tier, priceId]);
    console.log(`${plan.name}: ${priceId} verified (${money(plan.monthlyPriceAmount)}/month) and stored; available for sign-up.`);
  }
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}

if (problems.length) fail(`\nNot stored:\n- ${problems.join("\n- ")}`);
