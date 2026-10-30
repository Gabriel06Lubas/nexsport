import "server-only";

import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { stripeAccount } from "@/db/schema";
import { PAGE_SIZE } from "@/lib/list-params";
import { rows } from "@/modules/clubs/queries/shared";

// A coach's money: payments for sessions they ran, and the Stripe Connect
// transfers of their share. Streams follow the session kind:
//   PRIVATE → direct private sessions, GROUP → club commissions
//   (the coach's share of club-run classes), OPEN_MATCH → open matches.

export async function getCoachConnectAccount(userId: string) {
  const [account] = await db.select().from(stripeAccount).where(eq(stripeAccount.userId, userId));
  return account ?? null;
}

export type StreamRow = { kind: "PRIVATE" | "GROUP" | "OPEN_MATCH"; sessions: number; gross: number; share: number; share30: number; pending: number };

export async function getEarningsByStream(coachId: string) {
  return rows<StreamRow>(sql`
    SELECT s.kind,
           count(DISTINCT s.id)::int AS sessions,
           COALESCE(sum(pt.amount - pt."refundedAmount"), 0)::float8 AS gross,
           COALESCE(sum(tr.amount - tr."reversedAmount") FILTER (WHERE tr.status IN ('PAID', 'PENDING')), 0)::float8 AS share,
           COALESCE(sum(tr.amount - tr."reversedAmount") FILTER (WHERE tr.status IN ('PAID', 'PENDING') AND pt."paidAt" > now() - interval '30 days'), 0)::float8 AS share30,
           COALESCE(sum(tr.amount) FILTER (WHERE tr.status = 'PENDING'), 0)::float8 AS pending
      FROM "PracticeSession" s
      JOIN "PaymentTransaction" pt ON pt."sessionId" = s.id AND pt.status = 'SUCCEEDED'
      LEFT JOIN "PaymentTransfer" tr ON tr."paymentId" = pt.id AND tr."recipientType" = 'COACH'
     WHERE s."coachId" = ${coachId}
     GROUP BY s.kind`);
}

export async function getPayoutTotals(coachId: string) {
  const [t] = await rows<{ paid30: number; pending: number; failed: number; fees30: number }>(sql`
    WITH tr AS (
      SELECT tr.*, pt."paidAt" FROM "PaymentTransfer" tr
        JOIN "PaymentTransaction" pt ON pt.id = tr."paymentId"
        JOIN "StripeAccount" sa ON sa.id = tr."stripeAccountId"
       WHERE sa."userId" = ${coachId} AND tr."recipientType" = 'COACH'
    )
    SELECT COALESCE((SELECT sum(amount - "reversedAmount") FROM tr WHERE status = 'PAID' AND "paidAt" > now() - interval '30 days'), 0)::float8 AS paid30,
           COALESCE((SELECT sum(amount) FROM tr WHERE status = 'PENDING'), 0)::float8 AS pending,
           COALESCE((SELECT sum(amount) FROM tr WHERE status IN ('FAILED', 'REVERSED')), 0)::float8 AS failed,
           COALESCE((SELECT sum(pt."applicationFeeAmount") FROM "PaymentTransaction" pt JOIN "PracticeSession" s ON s.id = pt."sessionId"
                      WHERE s."coachId" = ${coachId} AND pt.status = 'SUCCEEDED' AND pt."paidAt" > now() - interval '30 days'), 0)::float8 AS fees30`);
  return t!;
}

export type EarningRow = {
  id: string;
  paidAt: Date | null;
  title: string;
  kind: "PRIVATE" | "GROUP" | "OPEN_MATCH";
  clubName: string;
  student: string;
  amount: number;
  currency: string;
  applicationFeeAmount: number;
  stripeFeeAmount: number | null;
  refundedAmount: number;
  share: number | null;
  shareStatus: string | null;
  stripeTransferId: string | null;
};

export async function listEarnings(coachId: string, page: number) {
  const [list, [{ total = 0 } = {}]] = await Promise.all([
    rows<EarningRow>(sql`
      SELECT pt.id, pt."paidAt", s.title, s.kind, c.name AS "clubName", COALESCE(u.name, u.email) AS student,
             pt.amount, pt.currency, pt."applicationFeeAmount", pt."stripeFeeAmount", pt."refundedAmount",
             tr.amount AS share, tr.status AS "shareStatus", tr."stripeTransferId"
        FROM "PaymentTransaction" pt
        JOIN "PracticeSession" s ON s.id = pt."sessionId"
        JOIN "Club" c ON c.id = s."clubId"
        JOIN "User" u ON u.id = pt."payerId"
        LEFT JOIN "PaymentTransfer" tr ON tr."paymentId" = pt.id AND tr."recipientType" = 'COACH'
       WHERE s."coachId" = ${coachId} AND pt.status = 'SUCCEEDED'
       ORDER BY pt."paidAt" DESC NULLS LAST, pt.id
       LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`),
    rows<{ total: number }>(sql`
      SELECT count(*)::int AS total FROM "PaymentTransaction" pt JOIN "PracticeSession" s ON s.id = pt."sessionId"
       WHERE s."coachId" = ${coachId} AND pt.status = 'SUCCEEDED'`),
  ]);
  return { list, total };
}
