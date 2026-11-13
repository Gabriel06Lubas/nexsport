-- New connected accounts use Stripe-managed risk and the full Stripe dashboard.
ALTER TYPE "public"."StripeAccountType" ADD VALUE 'STANDARD';
