"use client";

import { loadStripe, type Stripe, type StripeElements } from "@stripe/stripe-js";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

// Stripe's Payment Element for a PaymentIntent created on the server. Card
// details go from the browser straight to Stripe; nexport only ever sees the
// client_secret of this one PaymentIntent. confirmPayment redirects to
// returnPath when the payment needs no more steps (or after 3-D Secure);
// declines come back here as an error to retry with another card.

const loaders = new Map<string, Promise<Stripe | null>>();
const stripeFor = (key: string) => {
  if (!loaders.has(key)) loaders.set(key, loadStripe(key));
  return loaders.get(key)!;
};

export function PaymentStep({
  publishableKey,
  clientSecret,
  returnPath,
  amountLabel,
  holdExpiresAt,
}: {
  publishableKey: string;
  clientSecret: string;
  returnPath: string;
  amountLabel: string;
  holdExpiresAt: string;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [stripe, setStripe] = useState<Stripe | null>(null);
  const [elements, setElements] = useState<StripeElements | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(() => Date.parse(holdExpiresAt) - Date.now());

  useEffect(() => {
    let cancelled = false;
    stripeFor(publishableKey)
      .then((s) => {
        if (cancelled) return;
        if (!s || !mountRef.current) throw new Error("Stripe didn't load");
        const els = s.elements({ clientSecret, appearance: { theme: "stripe" } });
        els.create("payment").mount(mountRef.current);
        setStripe(s);
        setElements(els);
      })
      .catch(() => !cancelled && setError("The payment form couldn't load. Check your connection and reload the page."));
    return () => {
      cancelled = true;
    };
  }, [publishableKey, clientSecret]);

  useEffect(() => {
    const timer = setInterval(() => setLeft(Date.parse(holdExpiresAt) - Date.now()), 1000);
    return () => clearInterval(timer);
  }, [holdExpiresAt]);

  async function pay() {
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);
    const submitted = await elements.submit();
    if (submitted.error) {
      setError(submitted.error.message ?? "Check your payment details.");
      setBusy(false);
      return;
    }
    const result = await stripe.confirmPayment({ elements, confirmParams: { return_url: new URL(returnPath, window.location.origin).toString() } });
    // Only reached when the payment didn't go through (success redirects).
    setError(result.error?.message ?? "The payment didn't go through.");
    setBusy(false);
  }

  const expired = left <= 0;
  const mm = Math.max(0, Math.floor(left / 60_000));
  const ss = Math.max(0, Math.floor((left % 60_000) / 1000));

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {expired ? "The hold on this court has expired. Start again to book it." : `Court held for ${mm}:${String(ss).padStart(2, "0")} while you pay.`}
      </p>
      <div ref={mountRef} aria-label="Payment details" className="min-h-24 rounded-xl border border-border bg-background p-3" />
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="button" onClick={pay} disabled={!elements || busy || expired}>
        {busy ? "Paying…" : `Pay ${amountLabel}`}
      </Button>
      <p className="text-xs text-muted-foreground">Payments are processed by Stripe. nexport never sees your card number.</p>
    </div>
  );
}
