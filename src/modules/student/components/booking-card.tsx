import { MapPin, Navigation } from "lucide-react";

import { formatTime } from "@/components/dashboard/ui";
import { ActionButton } from "@/components/forms/action-form";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/utils";
import { zonedParts } from "@/modules/clubs/lib/zoned-time";

import { cancelMyBooking } from "../actions/bookings";
import { payHeldSeat } from "../actions/matches";
import { countdown, refundTimeline } from "../lib/cancellation";
import type { MyBooking } from "../queries/bookings";
import type { LoadedPolicy } from "../queries/policy";

const kindLabel = { PRIVATE: "Private session", GROUP: "Group clinic", OPEN_MATCH: "Open match" } as const;
const statusBadge = {
  CONFIRMED: { label: "Confirmed", variant: "success" },
  PENDING: { label: "Pending", variant: "warning" },
  CANCELLED: { label: "Cancelled", variant: "outline" },
} as const;

const dayFormat = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
export const bookingDay = (b: Pick<MyBooking, "startsAt" | "timezone">) => dayFormat.format(new Date(`${zonedParts(b.startsAt, b.timezone).dateKey}T12:00:00Z`));

/** Google Maps search for the club's address (no API key needed). */
export function directionsUrl(b: Pick<MyBooking, "clubName" | "address" | "city" | "country">) {
  const query = [b.clubName, b.address, b.city, b.country].filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** What cancelling now would mean, in one line. */
function refundLine(b: MyBooking, policy: LoadedPolicy, now: Date) {
  const t = refundTimeline(policy, b.startsAt, now);
  const paid = b.paymentStatus === "SUCCEEDED" ? (b.paymentAmount ?? 0) - (b.refundedAmount ?? 0) : b.rentalPayment === "ON_SITE" && b.paidAt ? b.priceAmount : 0;
  const money = (n: number) => formatMoney(n, b.currency);
  if (paid === 0) return { text: "Nothing paid yet: free to cancel.", tone: "muted" as const, percent: 100 };
  const now$ = money(Math.round((paid * t.percent) / 100));
  const until = t.until ? ` for ${countdown(t.until, now)} more, then ${t.nextPercent}%` : "";
  return { text: `Cancel now: ${t.percent}% back (${now$})${until}.`, tone: t.percent === 100 ? ("success" as const) : t.percent > 0 ? ("warning" as const) : ("danger" as const), percent: t.percent };
}

export function BookingCard({ booking: b, policy, now = new Date() }: { booking: MyBooking; policy: LoadedPolicy; now?: Date }) {
  const status = statusBadge[b.status];
  const upcoming = b.startsAt.getTime() > now.getTime();
  const pendingPayment = b.status === "PENDING" && b.paymentStatus === "REQUIRES_PAYMENT_METHOD" && b.checkoutExpiresAt && b.checkoutExpiresAt.getTime() > now.getTime();
  const refund = b.status !== "CANCELLED" && upcoming && !pendingPayment ? refundLine(b, policy, now) : null;
  const toneClass = { muted: "text-muted-foreground", success: "text-success", warning: "text-warning", danger: "text-danger" };

  return (
    <article aria-label={`${b.kind === "rental" ? "Court rental" : b.title}, ${bookingDay(b)}`} className={`rounded-2xl border border-border bg-card p-4 ${b.status === "CANCELLED" ? "opacity-70" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold tabular-nums">
            {bookingDay(b)} · {formatTime(b.startsAt, b.timezone)}–{formatTime(b.endsAt, b.timezone)}
          </p>
          <p className="mt-0.5 font-medium">{b.kind === "rental" ? `Court rental · ${b.facilityName}` : b.title}</p>
          <p className="text-xs text-muted-foreground">
            {b.kind === "rental" ? "Court rental" : kindLabel[b.sessionKind!]}
            {b.coachName && ` with ${b.coachName}`} · {b.clubName}
            {b.kind === "session" && ` · ${b.facilityName}`}
          </p>
        </div>
        <Badge variant={status.variant}>{status.label}</Badge>
      </div>

      <div className="mt-3 space-y-1 text-xs">
        {b.priceAmount > 0 && (
          <p className="text-muted-foreground">
            {formatMoney(b.paymentAmount ?? b.priceAmount, b.currency)}
            {" · "}
            {b.paymentStatus === "SUCCEEDED"
              ? "paid online"
              : pendingPayment
                ? `awaiting payment, spot held for ${countdown(b.checkoutExpiresAt!, now)}`
                : b.rentalPayment === "ON_SITE" && b.paidAt
                  ? "paid at the club"
                  : b.rentalPayment === "COMPLIMENTARY"
                    ? "complimentary"
                    : "pay at the club"}
          </p>
        )}
        {b.status === "CANCELLED" && (
          <p className="text-muted-foreground">
            {b.cancelledByMe ? "You cancelled" : "Cancelled by the club or coach"}
            {b.refundStatus && b.refundStatus !== "NONE" && ` · refund ${b.refundStatus === "PENDING" ? "processing" : `${formatMoney(b.refundedAmount ?? 0, b.currency)}`} (${b.appliedRefundPercent ?? 0}%)`}
          </p>
        )}
        {refund && <p className={toneClass[refund.tone]}>{refund.text}</p>}
      </div>

      <div className="mt-3 flex flex-wrap items-start gap-2">
        {pendingPayment && (
          <ActionButton action={payHeldSeat} hidden={{ paymentId: b.paymentId! }} variant="primary" pendingLabel="Opening Stripe…">
            Pay now
          </ActionButton>
        )}
        {upcoming && (
          // Rendered (disabled) after cancelling too, so its confirmation and
          // refund message stay on screen when the card turns "Cancelled".
          <ActionButton
            action={cancelMyBooking}
            hidden={{ kind: b.kind, id: b.id }}
            confirm={pendingPayment ? "Release this spot?" : refund ? `Cancel this booking? ${refund.text}` : "Cancel this booking?"}
            pendingLabel="Cancelling…"
            disabled={b.status === "CANCELLED"}
          >
            {b.status === "CANCELLED" ? "Cancelled" : pendingPayment ? "Release spot" : "Cancel booking"}
          </ActionButton>
        )}
        {b.status !== "CANCELLED" && (
          <a href={directionsUrl(b)} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border px-3 text-xs font-semibold hover:bg-muted">
            <Navigation className="size-3.5" aria-hidden /> Get directions
          </a>
        )}
        {b.address && (
          <span className="inline-flex items-center gap-1 self-center text-xs text-muted-foreground">
            <MapPin className="size-3.5" aria-hidden /> {[b.address, b.city].filter(Boolean).join(", ")}
          </span>
        )}
      </div>
    </article>
  );
}
