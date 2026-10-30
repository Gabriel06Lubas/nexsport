"use server";

import { createId } from "@paralleldrive/cuid2";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import type { Route } from "next";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { db } from "@/db";
import { isBookingConflict, isUniqueViolation } from "@/db/errors";
import { club, paymentTransaction, practiceSession, sessionParticipant } from "@/db/schema";
import { formValues, type ActionState } from "@/lib/action-state";
import { formatMoney } from "@/lib/utils";
import { platformFeeBpsFor } from "@/modules/payments/platform-fee";
import { releaseExpiredHolds } from "@/modules/payments/settle";
import { CHECKOUT_HOLD_MINUTES, createSeatCheckout, ensureCustomer, getStripe } from "@/modules/payments/stripe";

import { requireStudent } from "../dal";
import { levelFits } from "../lib/cancellation";
import { joinSchema } from "../lib/forms";
import { getMyLevels } from "../queries/matches";

// Joining an open match. The seat is taken in the database first (the seat
// guard refuses a full match, even when two players click at once). With
// Stripe configured and a price, the seat is held for CHECKOUT_HOLD_MINUTES
// while the player pays their share in Stripe Checkout; the webhook confirms
// it, or the hold is released. Without Stripe, the share is paid at the club.

export async function joinOpenMatch(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const student = await requireStudent();
  const parsed = joinSchema.safeParse(formValues(formData));
  if (!parsed.success) return { error: "Unknown match." };
  const { sessionId } = parsed.data;
  await releaseExpiredHolds(sessionId);

  const [match] = await db
    .select({
      id: practiceSession.id,
      title: practiceSession.title,
      sportId: practiceSession.sportId,
      coachId: practiceSession.coachId,
      clubId: practiceSession.clubId,
      clubName: club.name,
      minLevel: practiceSession.minLevel,
      maxLevel: practiceSession.maxLevel,
      priceAmount: practiceSession.priceAmount,
      currency: practiceSession.currency,
    })
    .from(practiceSession)
    .innerJoin(club, eq(club.id, practiceSession.clubId))
    .where(
      and(
        eq(practiceSession.id, sessionId),
        eq(practiceSession.kind, "OPEN_MATCH"),
        eq(practiceSession.status, "SCHEDULED"),
        gt(practiceSession.startsAt, sql`now()`),
        inArray(club.status, ["ACTIVE", "PENDING_SETUP"]),
      ),
    );
  if (!match) return { error: "This match isn't open any more." };
  if (match.coachId === student.id) return { error: "You're running this match." };
  const level = (await getMyLevels(student.id)).get(match.sportId) ?? null;
  if (!levelFits(level, match.minLevel, match.maxLevel)) {
    return { error: level === null ? "Set your level for this sport in Settings to join level-matched games." : `This match is for level ${match.minLevel ?? "any"}–${match.maxLevel ?? "any"}; yours is ${level}.` };
  }

  const stripe = getStripe();
  const online = stripe !== null && match.priceAmount > 0;
  const feeBps = online ? await platformFeeBpsFor(match.clubId) : 0;
  const holdUntil = new Date(Date.now() + CHECKOUT_HOLD_MINUTES * 60_000);

  let held: { paymentId: string; participantId: string } | null = null;
  try {
    held = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: sessionParticipant.id, status: sessionParticipant.status })
        .from(sessionParticipant)
        .where(and(eq(sessionParticipant.sessionId, match.id), eq(sessionParticipant.userId, student.id)));
      if (existing?.status === "ACCEPTED") throw new AlreadyIn();
      let participantId: string;
      if (existing) {
        await tx.update(sessionParticipant).set({ status: "ACCEPTED", cancelledAt: null, respondedAt: new Date() }).where(eq(sessionParticipant.id, existing.id));
        participantId = existing.id;
      } else {
        const [created] = await tx
          .insert(sessionParticipant)
          .values({ sessionId: match.id, userId: student.id, status: "ACCEPTED", respondedAt: new Date() })
          .returning({ id: sessionParticipant.id });
        participantId = created!.id;
      }
      if (!online) return null;
      const paymentId = createId();
      await tx.insert(paymentTransaction).values({
        id: paymentId,
        clubId: match.clubId,
        kind: "SESSION",
        sessionId: match.id,
        participantId,
        payerId: student.id,
        coachId: match.coachId,
        amount: match.priceAmount,
        currency: match.currency,
        applicationFeeAmount: Math.min(match.priceAmount, Math.round((match.priceAmount * feeBps) / 10_000)),
        status: "REQUIRES_PAYMENT_METHOD",
        transferGroup: `seat_${participantId}`,
        idempotencyKey: paymentId,
        checkoutExpiresAt: holdUntil,
      });
      return { paymentId, participantId };
    });
  } catch (e) {
    if (e instanceof AlreadyIn) return { error: "You're already in this match." };
    if (isBookingConflict(e) === "SessionParticipant_capacity") return { error: "This match just filled up." };
    if (isUniqueViolation(e, "PaymentTransaction_one_live_per_participant")) return { error: "You were refunded for this match earlier; ask the club to add you back." };
    throw e;
  }

  revalidatePath("/dashboard/student", "layout");
  if (!held) {
    return { ok: match.priceAmount > 0 ? `You're in! Pay your ${formatMoney(match.priceAmount, match.currency)} share at ${match.clubName}.` : "You're in!" };
  }

  let checkoutUrl: string;
  try {
    const customerId = await ensureCustomer(stripe!, student);
    const checkout = await createSeatCheckout(stripe!, {
      paymentId: held.paymentId,
      idempotencyKey: held.paymentId,
      customerId,
      amount: match.priceAmount,
      currency: match.currency,
      description: `${match.title} · ${match.clubName} (your share)`,
      transferGroup: `seat_${held.participantId}`,
      expiresAt: holdUntil,
      successPath: `/dashboard/student/bookings?checkout=success&payment=${held.paymentId}`,
      cancelPath: `/dashboard/student?checkout=cancelled&payment=${held.paymentId}`,
    });
    await db.update(paymentTransaction).set({ stripeCheckoutSessionId: checkout.id, checkoutUrl: checkout.url }).where(eq(paymentTransaction.id, held.paymentId));
    checkoutUrl = checkout.url;
  } catch (error) {
    // Couldn't start the payment: give the seat back.
    console.error("[stripe] checkout failed", error);
    await db.transaction(async (tx) => {
      await tx.update(paymentTransaction).set({ status: "CANCELED" }).where(eq(paymentTransaction.id, held.paymentId));
      await tx.update(sessionParticipant).set({ status: "CANCELLED", cancelledAt: new Date() }).where(eq(sessionParticipant.id, held.participantId));
    });
    return { error: "Payments are unavailable right now, so your spot wasn't reserved. Try again in a moment." };
  }
  // An external URL (Stripe Checkout); typed routes only cover our own.
  redirect(checkoutUrl as Route);
}

/** Back to Stripe Checkout for a seat that's still held. */
export async function payHeldSeat(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const student = await requireStudent();
  const paymentId = String(formData.get("paymentId") ?? "");
  if (!/^[a-z0-9]{1,64}$/.test(paymentId)) return { error: "Unknown payment." };
  const [payment] = await db
    .select({ url: paymentTransaction.checkoutUrl })
    .from(paymentTransaction)
    .where(
      and(
        eq(paymentTransaction.id, paymentId),
        eq(paymentTransaction.payerId, student.id),
        eq(paymentTransaction.status, "REQUIRES_PAYMENT_METHOD"),
        gt(paymentTransaction.checkoutExpiresAt, sql`now()`),
      ),
    );
  if (!payment?.url) return { error: "That hold has expired; join the match again if there's still room." };
  redirect(payment.url as Route);
}

class AlreadyIn extends Error {}
