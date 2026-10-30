import { notFound } from "next/navigation";
import type { NextRequest } from "next/server";

import { requireClubAccess } from "@/modules/clubs/dal";
import { monthSchema } from "@/modules/clubs/lib/forms";
import { currentMonth, getPayoutReport, toCsv } from "@/modules/clubs/queries/staff";

// GET /dashboard/:clubSlug/staff/payout-report?month=YYYY-MM → CSV download.
// Same gate as the payroll panel: club member with MANAGE_BILLING, else 404.
export async function GET(request: NextRequest, { params }: { params: Promise<{ clubSlug: string }> }) {
  const { clubSlug } = await params;
  const access = await requireClubAccess(clubSlug, "MANAGE_BILLING");
  const raw = request.nextUrl.searchParams.get("month") ?? currentMonth(access.club.timezone);
  const parsed = monthSchema.safeParse(raw);
  if (!parsed.success) notFound();
  const month = parsed.data;

  const report = await getPayoutReport(access.club, month);
  const cents = (n: number | null) => (n === null ? null : (n / 100).toFixed(2));
  const csv = toCsv(
    [
      "Name",
      "Email",
      "Role",
      "Employment",
      "Sessions",
      "Billable hours",
      `Session revenue (${access.club.currency.toUpperCase()})`,
      "Platform fees",
      "Coach split paid (Stripe)",
      "Coach split pending (Stripe)",
      "Coach split failed (Stripe)",
      "Club split (Stripe)",
      "Hourly wage",
      "Commission %",
      "Wages due",
    ],
    report.map((r) => [
      r.name,
      r.email,
      r.role,
      r.employment,
      r.sessions,
      r.hours.toFixed(2),
      cents(r.gross),
      cents(r.platformFees),
      cents(r.coachPaid),
      cents(r.coachPending),
      cents(r.coachFailed),
      cents(r.clubShare),
      cents(r.hourlyWage),
      r.commissionBps === null ? null : (r.commissionBps / 100).toString(),
      cents(r.wagesDue),
    ]),
  );

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="payouts-${access.club.slug}-${month}.csv"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
