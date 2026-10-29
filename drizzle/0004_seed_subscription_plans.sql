-- Custom SQL migration (drizzle-kit generate --custom --name=seed_subscription_plans).
--
-- The four SaaS plans. Prices, fees and limits are starting values that
-- admins edit in /admin/subscriptions. Paid plans start inactive: a plan can
-- only be activated once it has a Stripe Price ID (CHECK
-- "SubscriptionPlan_paid_has_price"), since it can't be sold without one.
-- Limits: NULL = unlimited. Amounts in cents; fees in basis points (300 = 3%).
INSERT INTO "SubscriptionPlan"
  ("tier", "name", "audience", "monthlyPriceAmount", "currency", "platformFeeBps", "stripePriceId", "maxFacilities", "maxStaff", "maxAthletes", "isActive", "updatedAt")
VALUES
  ('FREE_COACH',      'Free Coach',      'COACH', 0,     'eur', 1000, NULL, 0,    0,    30,   true,  now()),
  ('PRO_COACH',       'Pro Coach',       'COACH', 2900,  'eur', 500,  NULL, 0,    0,    NULL, false, now()),
  ('CLUB_BASIC',      'Club Basic',      'CLUB',  4900,  'eur', 600,  NULL, 4,    10,   300,  false, now()),
  ('CLUB_ENTERPRISE', 'Club Enterprise', 'CLUB',  14900, 'eur', 300,  NULL, NULL, NULL, NULL, false, now())
ON CONFLICT ("tier") DO NOTHING;
