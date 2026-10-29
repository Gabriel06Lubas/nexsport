"use client";

import { useId, useState } from "react";

import { tiers } from "@/config/pricing";
import { formatMoney } from "@/lib/utils";
import { estimateProcessingFee, splitSessionPayment } from "@/modules/billing/lib/fee-split";

const payTiers = tiers.filter((t) => t.platformFeeBps !== null);

export function FeeSplitCalculator() {
  const id = useId();
  const [price, setPrice] = useState(30);
  const [tierId, setTierId] = useState("PRO");
  const [coachShare, setCoachShare] = useState(70);
  const [cardPct, setCardPct] = useState(1.5);
  const [cardFixed, setCardFixed] = useState(0.25);

  const tier = payTiers.find((t) => t.id === tierId) ?? payTiers[0]!;
  const amount = Math.max(Math.round(price * 100), 1);
  const split = splitSessionPayment({
    amount,
    platformFeeBps: tier.platformFeeBps ?? 0,
    coachShareBps: coachShare * 100,
    processingFee: estimateProcessingFee(amount, Math.round(cardPct * 100), Math.round(cardFixed * 100)),
  });

  const rows = [
    { label: "Coach payout", value: split.coachAmount, note: `${coachShare}% of the net` },
    { label: "Club payout", value: split.clubAmount, note: "The rest of the net" },
    { label: `Platform fee (${tier.name})`, value: split.platformFee, note: `${(tier.platformFeeBps ?? 0) / 100}%` },
    { label: "Card processing", value: split.processingFee, note: "Charged by Stripe" },
  ];

  const field = "mt-1 h-10 w-full rounded-lg border border-border bg-card px-3 tabular-nums";

  return (
    <div className="grid gap-6 rounded-2xl border border-border bg-card p-4 sm:p-6 lg:grid-cols-[1fr_1.2fr]">
      <div className="grid grid-cols-2 content-start gap-3">
        <label className="text-sm" htmlFor={`${id}-price`}>
          <span className="text-muted-foreground">Session price (€)</span>
          <input id={`${id}-price`} type="number" min={1} step={1} value={price} onChange={(e) => setPrice(Number(e.target.value) || 0)} className={field} />
        </label>
        <label className="text-sm" htmlFor={`${id}-tier`}>
          <span className="text-muted-foreground">Plan</span>
          <select id={`${id}-tier`} value={tierId} onChange={(e) => setTierId(e.target.value)} className={field}>
            {payTiers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}: {(t.platformFeeBps ?? 0) / 100}% fee
              </option>
            ))}
          </select>
        </label>
        <label className="col-span-2 text-sm" htmlFor={`${id}-share`}>
          <span className="flex justify-between text-muted-foreground">
            Coach share of the net <span className="font-semibold tabular-nums text-foreground">{coachShare}%</span>
          </span>
          <input id={`${id}-share`} type="range" min={0} max={100} step={5} value={coachShare} onChange={(e) => setCoachShare(Number(e.target.value))} className="mt-2 w-full accent-[var(--chart-1)]" />
        </label>
        <label className="text-sm" htmlFor={`${id}-pct`}>
          <span className="text-muted-foreground">Card fee (%)</span>
          <input id={`${id}-pct`} type="number" min={0} step={0.1} value={cardPct} onChange={(e) => setCardPct(Number(e.target.value) || 0)} className={field} />
        </label>
        <label className="text-sm" htmlFor={`${id}-fixed`}>
          <span className="text-muted-foreground">+ fixed (€)</span>
          <input id={`${id}-fixed`} type="number" min={0} step={0.05} value={cardFixed} onChange={(e) => setCardFixed(Number(e.target.value) || 0)} className={field} />
        </label>
        <p className="col-span-2 text-xs text-muted-foreground">
          Card fees vary by country and card type. Enter your own Stripe rate for an exact figure.
        </p>
      </div>

      <div aria-live="polite">
        <p className="text-sm text-muted-foreground">An athlete pays</p>
        <p className="text-4xl font-semibold tabular-nums">{formatMoney(split.amount)}</p>
        <ul className="mt-5 space-y-3">
          {rows.map((r) => (
            <li key={r.label}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span>
                  {r.label} <span className="text-xs text-muted-foreground">· {r.note}</span>
                </span>
                <span className="font-semibold tabular-nums">{formatMoney(r.value)}</span>
              </div>
              <div className="mt-1.5 h-2 rounded-full bg-muted">
                <div className="h-2 rounded-full bg-chart-1" style={{ width: `${(r.value / split.amount) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-5 text-xs text-muted-foreground">
          Payouts go straight to the club’s and coach’s own Stripe accounts. The four amounts always add up to exactly what the athlete paid.
        </p>
      </div>
    </div>
  );
}
