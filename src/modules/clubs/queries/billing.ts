import "server-only";

import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { stripeAccount } from "@/db/schema";
import { PAGE_SIZE } from "@/lib/list-params";

import { rows, type ClubRef } from "./shared";

export async function getConnectAccount(clubId: string) {
  const [account] = await db.select().from(stripeAccount).where(eq(stripeAccount.clubId, clubId));
  return account ?? null;
}

/** Last 30 days of online payments: what customers paid and where it went. */
export async function getMoneyFlow(club: ClubRef) {
  const [flow] = await rows<{
    gross: number;
    refunded: number;
    platformFees: number;
    processingFees: number;
    toClub: number;
    toCoaches: number;
    clubPending: number;
    clubFailed: number;
    payments: number;
  }>(sql`
    WITH p AS (
      SELECT * FROM "PaymentTransaction"
       WHERE "clubId" = ${club.id} AND status = 'SUCCEEDED' AND currency = ${club.currency} AND "paidAt" > now() - interval '30 days'
    ),
    t AS (SELECT tr.* FROM "PaymentTransfer" tr JOIN p ON p.id = tr."paymentId")
    SELECT COALESCE((SELECT sum(amount) FROM p), 0)::float8 AS gross,
           COALESCE((SELECT sum("refundedAmount") FROM p), 0)::float8 AS refunded,
           COALESCE((SELECT sum("applicationFeeAmount") FROM p), 0)::float8 AS "platformFees",
           COALESCE((SELECT sum("stripeFeeAmount") FROM p), 0)::float8 AS "processingFees",
           COALESCE((SELECT sum(amount - "reversedAmount") FROM t WHERE "recipientType" = 'CLUB' AND status = 'PAID'), 0)::float8 AS "toClub",
           COALESCE((SELECT sum(amount - "reversedAmount") FROM t WHERE "recipientType" = 'COACH' AND status IN ('PAID', 'PENDING')), 0)::float8 AS "toCoaches",
           COALESCE((SELECT sum(amount) FROM t WHERE "recipientType" = 'CLUB' AND status = 'PENDING'), 0)::float8 AS "clubPending",
           COALESCE((SELECT sum(amount) FROM t WHERE "recipientType" = 'CLUB' AND status IN ('FAILED', 'REVERSED')), 0)::float8 AS "clubFailed",
           (SELECT count(*)::int FROM p) AS payments`);
  return flow!;
}

export const TX_KINDS = ["all", "SESSION", "COURT_RENTAL", "MEMBERSHIP"] as const;
export type TxKind = (typeof TX_KINDS)[number];

export type TxRow = {
  id: string;
  kind: "SESSION" | "COURT_RENTAL" | "MEMBERSHIP";
  status: string;
  description: string;
  payer: string;
  amount: number;
  currency: string;
  applicationFeeAmount: number;
  stripeFeeAmount: number | null;
  refundedAmount: number;
  disputeStatus: string;
  paidAt: Date | null;
  createdAt: Date;
  clubTransfer: number | null;
  clubTransferStatus: string | null;
  coachTransfer: number | null;
  coachTransferStatus: string | null;
};

/** Every online payment with its Connect split, newest first. */
export async function listTransactions(clubId: string, { kind, page }: { kind: TxKind; page: number }) {
  const where = kind === "all" ? sql`pt."clubId" = ${clubId}` : sql`pt."clubId" = ${clubId} AND pt.kind = ${kind}`;
  const [txs, [{ total = 0 } = {}]] = await Promise.all([
    rows<TxRow>(sql`
      SELECT pt.id, pt.kind, pt.status, pt.amount, pt.currency, pt."applicationFeeAmount", pt."stripeFeeAmount", pt."refundedAmount",
             pt."disputeStatus", pt."paidAt", pt."createdAt",
             CASE pt.kind
               WHEN 'SESSION' THEN s.title
               WHEN 'COURT_RENTAL' THEN 'Court rental · ' || f.name
               ELSE 'Membership · ' || mpl.name
             END AS description,
             COALESCE(u.name, u.email) AS payer,
             club_tr.amount AS "clubTransfer", club_tr.status AS "clubTransferStatus",
             coach_tr.amount AS "coachTransfer", coach_tr.status AS "coachTransferStatus"
        FROM "PaymentTransaction" pt
        JOIN "User" u ON u.id = pt."payerId"
        LEFT JOIN "PracticeSession" s ON s.id = pt."sessionId"
        LEFT JOIN "FacilityBooking" fb ON fb.id = pt."facilityBookingId"
        LEFT JOIN "Facility" f ON f.id = fb."facilityId"
        LEFT JOIN "MemberPass" mp ON mp.id = pt."memberPassId"
        LEFT JOIN "MembershipPlan" mpl ON mpl.id = mp."planId"
        LEFT JOIN "PaymentTransfer" club_tr ON club_tr."paymentId" = pt.id AND club_tr."recipientType" = 'CLUB'
        LEFT JOIN "PaymentTransfer" coach_tr ON coach_tr."paymentId" = pt.id AND coach_tr."recipientType" = 'COACH'
       WHERE ${where}
       ORDER BY COALESCE(pt."paidAt", pt."createdAt") DESC, pt.id
       LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`),
    rows<{ total: number }>(sql`SELECT count(*)::int AS total FROM "PaymentTransaction" pt WHERE ${where}`),
  ]);
  return { txs, total };
}
