"use client";

import { useId, useState } from "react";

import { cn, formatMoney } from "@/lib/utils";
import { computeRefund, type RefundPolicy } from "@/modules/billing/lib/refund-policy";

const presets: Record<string, RefundPolicy & { name: string }> = {
  flexible: { name: "Flexible", organizerCancelRefundPercent: 100, rules: [{ minHoursBeforeStart: 12, refundPercent: 100 }] },
  standard: {
    name: "Standard",
    organizerCancelRefundPercent: 100,
    rules: [
      { minHoursBeforeStart: 48, refundPercent: 100 },
      { minHoursBeforeStart: 24, refundPercent: 50 },
    ],
  },
  strict: { name: "Strict", organizerCancelRefundPercent: 100, rules: [{ minHoursBeforeStart: 72, refundPercent: 50 }] },
};

export function RefundCalculator() {
  const id = useId();
  const [presetKey, setPresetKey] = useState("standard");
  const [hours, setHours] = useState(30);
  const [by, setBy] = useState<"PARTICIPANT" | "ORGANIZER">("PARTICIPANT");
  const amount = 2400;
  const policy = presets[presetKey]!;
  const decision = computeRefund(policy, amount, hours, by);
  const rules = [...policy.rules].sort((a, b) => b.minHoursBeforeStart - a.minHoursBeforeStart);

  return (
    <div className="rounded-2xl border border-border bg-card p-4 sm:p-6">
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Cancellation policy">
        {Object.entries(presets).map(([key, p]) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={presetKey === key}
            onClick={() => setPresetKey(key)}
            className={cn("rounded-full border px-4 py-1.5 text-sm font-medium", presetKey === key ? "border-ink bg-ink text-ink-foreground" : "border-border hover:bg-muted")}
          >
            {p.name}
          </button>
        ))}
      </div>

      <ul className="mt-4 space-y-1.5 text-sm">
        {rules.map((r) => (
          <li
            key={r.minHoursBeforeStart}
            className={cn("flex justify-between rounded-lg px-3 py-2", by === "PARTICIPANT" && decision.rule === r ? "bg-lime text-lime-foreground" : "bg-muted")}
          >
            <span>Cancelled {r.minHoursBeforeStart}h+ before start</span>
            <span className="font-semibold">{r.refundPercent}% refund</span>
          </li>
        ))}
        <li className={cn("flex justify-between rounded-lg px-3 py-2", by === "PARTICIPANT" && !decision.rule ? "bg-lime text-lime-foreground" : "bg-muted")}>
          <span>Later than that</span>
          <span className="font-semibold">No refund</span>
        </li>
      </ul>

      <label className="mt-5 block text-sm" htmlFor={`${id}-hours`}>
        <span className="flex justify-between text-muted-foreground">
          Cancelled before start <span className="font-semibold tabular-nums text-foreground">{hours} h</span>
        </span>
        <input id={`${id}-hours`} type="range" min={0} max={96} value={hours} onChange={(e) => setHours(Number(e.target.value))} className="mt-2 w-full accent-[var(--chart-1)]" />
      </label>

      <fieldset className="mt-4 flex flex-wrap gap-4 text-sm">
        <legend className="sr-only">Who cancelled</legend>
        {(["PARTICIPANT", "ORGANIZER"] as const).map((v) => (
          <label key={v} className="flex items-center gap-2">
            <input type="radio" name={`${id}-by`} checked={by === v} onChange={() => setBy(v)} className="accent-[var(--chart-1)]" />
            {v === "PARTICIPANT" ? "Athlete cancels" : "Club or coach cancels"}
          </label>
        ))}
      </fieldset>

      <div aria-live="polite" className="mt-5 flex items-end justify-between gap-4 border-t border-border pt-4">
        <div>
          <p className="text-sm text-muted-foreground">Automatic refund on a {formatMoney(amount)} booking</p>
          <p className="text-3xl font-semibold tabular-nums">{formatMoney(decision.refundAmount)}</p>
        </div>
        <span className="text-sm font-semibold tabular-nums">{decision.refundPercent}%</span>
      </div>
    </div>
  );
}
