-- Custom SQL migration (drizzle-kit generate --custom --name=finalize_plans).
--
-- The finalized plans, as published on /pricing (src/config/plans.json is the
-- source; keep the two in step). Prices are in cents (USD) and fees in basis
-- points; NULL limits are unlimited.
--
-- Stripe Price IDs and the active flag are deliberately left alone: they're
-- set by `npm run stripe:plans` once matching Prices exist in Stripe (a paid
-- plan can't be active without one, CHECK "SubscriptionPlan_paid_has_price").
-- Existing subscriptions keep what they pay: MRR reads
-- Subscription.monthlyAmount, a snapshot, not these list prices.
UPDATE "SubscriptionPlan" AS p
   SET "name" = v.name,
       "monthlyPriceAmount" = v.price,
       "currency" = 'usd',
       "platformFeeBps" = v.fee,
       "maxFacilities" = v.max_facilities,
       "maxStaff" = v.max_staff,
       "maxAthletes" = v.max_athletes,
       "updatedAt" = now()
  FROM (VALUES
    ('FREE_COACH',      'Free Coach',      0,     500, 0,    0,    15),
    ('PRO_COACH',       'Pro Coach',       2900,  300, 0,    0,    NULL),
    ('CLUB_BASIC',      'Club Basic',      9900,  600, 5,    10,   300),
    ('CLUB_ENTERPRISE', 'Club Enterprise', 29900, 300, NULL, NULL, NULL)
  ) AS v(tier, name, price, fee, max_facilities, max_staff, max_athletes)
 WHERE p."tier"::text = v.tier;
