import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { feePlans, planCurrency, planFacts, pricingCards } from "./pricing";

const card = (id: string) => pricingCards.find((c) => c.id === id)!;

describe("published plans", () => {
  it("have the finalized prices, badges and segments", () => {
    expect(planCurrency).toBe("usd");
    expect(pricingCards.map((c) => [c.id, c.segment, c.monthlyPriceAmount, c.badge ?? null])).toEqual([
      ["FREE_COACH", "coaches", 0, null],
      ["PRO_COACH", "coaches", 2900, "Popular for Coaches"],
      ["CLUB_BASIC", "clubs", 9900, "Popular for Clubs"],
      ["CLUB_ENTERPRISE", "clubs", 29900, null],
      ["ATHLETE_FREE", "athletes", 0, null],
    ]);
  });

  it("list the agreed features, with fees and limits from the plan facts", () => {
    expect(card("FREE_COACH").features).toEqual([
      "1 Coach License",
      "Up to 15 active students",
      "Basic practice session scheduling (private sessions)",
      "Attendance tracking (Present / Absent / Late)",
      "Standard Stripe Connect processing (5% platform fee)",
    ]);
    expect(card("PRO_COACH").includesPrevious).toBe("Everything in Free, plus:");
    expect(card("PRO_COACH").features).toContain("Reduced platform fee (3%)");
    expect(card("PRO_COACH").features).toContain("Public self-serve booking URL (nexport.com/coach/your-name)");
    expect(card("CLUB_BASIC").features[0]).toBe("Up to 5 courts or fields");
    expect(card("CLUB_ENTERPRISE").includesPrevious).toBe("Everything in Basic, plus:");
    expect(card("CLUB_ENTERPRISE").features).toContain("Open match split-payment system");
    expect(card("ATHLETE_FREE").features).toEqual([
      "Free account creation",
      "Pay-per-booking court rentals & private coaching",
      "Open match finder with split payment checkout",
      "Multi-session credit pass management",
    ]);
  });

  it("send every button somewhere real", () => {
    for (const c of pricingCards) expect(c.cta.href).toMatch(/^\/(login|contact)(\?plan=[A-Z_]+)?$/);
  });

  it("match migration 0011, so the database enforces what the page sells", () => {
    const sql = readFileSync(join(process.cwd(), "drizzle/0011_finalize_plans.sql"), "utf8");
    const rows = [...sql.matchAll(/\('(\w+)',\s*'([^']+)',\s*(\d+),\s*(\d+),\s*(\w+),\s*(\w+),\s*(\w+)\)/g)].map((m) => ({
      tier: m[1],
      name: m[2],
      monthlyPriceAmount: Number(m[3]),
      platformFeeBps: Number(m[4]),
      limits: { maxFacilities: m[5] === "NULL" ? null : Number(m[5]), maxStaff: m[6] === "NULL" ? null : Number(m[6]), maxAthletes: m[7] === "NULL" ? null : Number(m[7]) },
    }));
    expect(rows).toEqual(planFacts.map(({ tier, name, monthlyPriceAmount, platformFeeBps, limits }) => ({ tier, name, monthlyPriceAmount, platformFeeBps, limits })));
  });

  it("feed every plan's fee to the payout calculator", () => {
    expect(feePlans.map((p) => p.platformFeeBps)).toEqual([500, 300, 600, 300]);
  });
});
