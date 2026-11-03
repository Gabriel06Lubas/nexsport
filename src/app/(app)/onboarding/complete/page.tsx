import { and, eq } from "drizzle-orm";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { RefreshWhile } from "@/components/refresh-while";
import { db } from "@/db";
import { club, planCheckout } from "@/db/schema";
import { requireUser } from "@/modules/auth/dal";

export const metadata: Metadata = { title: "Setting up" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// Step 3 of 3: back from Stripe. The club (or the Pro plan) is provisioned by
// the webhook, not by this page: it only waits for that and moves on. Arriving
// here without paying changes nothing.
export default async function CompletePage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const id = (await searchParams).checkout;
  const checkoutId = typeof id === "string" && /^[a-z0-9]{1,64}$/.test(id) ? id : null;
  const [row] = checkoutId
    ? await db
        .select({ status: planCheckout.status, kind: planCheckout.kind, clubName: planCheckout.clubName, slug: club.slug })
        .from(planCheckout)
        .leftJoin(club, eq(club.id, planCheckout.clubId))
        .where(and(eq(planCheckout.id, checkoutId), eq(planCheckout.userId, user.id)))
    : [];
  if (!row) redirect(user.onboarded ? "/dashboard" : "/onboarding");

  if (row.status === "COMPLETED") {
    if (row.kind === "COACH_PRO") redirect("/dashboard/coach?upgraded=1");
    redirect((row.slug ? `/dashboard/${row.slug}` : "/dashboard/club") as Route);
  }

  return (
    <div className="mx-auto max-w-xl space-y-4 text-center">
      <p className="text-sm font-semibold uppercase tracking-wider text-accent-text">Step 3 of 3</p>
      {row.status === "OPEN" ? (
        <>
          <RefreshWhile active />
          <h1 className="text-3xl font-semibold tracking-tight">Confirming your payment…</h1>
          <p className="text-muted-foreground" aria-live="polite">
            {row.kind === "CLUB_SIGNUP" ? `We're setting up ${row.clubName} as soon as Stripe confirms the payment.` : "This takes a few seconds."}
          </p>
          <p className="text-xs text-muted-foreground">Still here after a minute? Reload the page; if the payment didn&apos;t go through, nothing was charged or created.</p>
        </>
      ) : (
        <>
          <h1 className="text-3xl font-semibold tracking-tight">{row.status === "EXPIRED" ? "That checkout expired" : "We couldn't finish setting up"}</h1>
          <p className="text-muted-foreground">
            {row.status === "EXPIRED"
              ? "Nothing was charged or created."
              : `Your payment needs a manual check before we can finish. Contact support and mention reference ${checkoutId}.`}
          </p>
          <Link href={(user.onboarded ? "/dashboard" : "/onboarding/plan?for=club") as Route} className="inline-block font-medium text-accent-text hover:underline">
            {user.onboarded ? "Back to your dashboard" : "Choose a plan again"}
          </Link>
        </>
      )}
    </div>
  );
}
