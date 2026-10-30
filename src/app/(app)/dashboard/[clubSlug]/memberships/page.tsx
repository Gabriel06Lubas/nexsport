import type { Metadata, Route } from "next";
import Link from "next/link";

import { EmptyState, formatDate, PageHeader, Pagination, Panel, TableWrap, td, th } from "@/components/dashboard/ui";
import { ActionButton, ActionForm, Field, FormFooter, SelectField } from "@/components/forms/action-form";
import { Badge } from "@/components/ui/badge";
import { parseListParams, pickParam } from "@/lib/list-params";
import { centsToInput } from "@/lib/money-input";
import { cn, formatMoney } from "@/lib/utils";
import { cancelPass, redeemCredit, savePlan, sellPass, setPlanActive } from "@/modules/clubs/actions/memberships";
import { requireClubSection, type ClubAccess } from "@/modules/clubs/dal";
import { zonedParts } from "@/modules/clubs/lib/zoned-time";
import { listPasses, listPlans, PASS_FILTERS, type PassFilter, type PassRow } from "@/modules/clubs/queries/memberships";

export const metadata: Metadata = { title: "Memberships & Passes" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type Plan = Awaited<ReturnType<typeof listPlans>>[number];

const filterLabels: Record<PassFilter, string> = { active: "Active & upcoming", expiring: "Running out", ended: "Ended", all: "All" };
const kindOptions = [
  { value: "UNLIMITED", label: "Unlimited (time-based)" },
  { value: "CREDITS", label: "Session pass (credits)" },
];
const paymentOptions = [
  { value: "ON_SITE", label: "Paid at the desk" },
  { value: "COMPLIMENTARY", label: "Complimentary" },
];

function passState(p: PassRow, now: number) {
  if (p.cancelledAt) return { label: "Cancelled", variant: "outline" as const };
  if (new Date(p.startsAt).getTime() > now) return { label: "Starts later", variant: "neutral" as const };
  if (new Date(p.expiresAt).getTime() <= now) return { label: "Expired", variant: "outline" as const };
  if (p.creditsTotal !== null && p.creditsUsed >= p.creditsTotal) return { label: "Used up", variant: "outline" as const };
  return { label: "Active", variant: "success" as const };
}

export default async function MembershipsPage({ params, searchParams }: { params: Promise<{ clubSlug: string }>; searchParams: SearchParams }) {
  const { clubSlug } = await params;
  const access = await requireClubSection(clubSlug, "memberships");
  const { club } = access;
  const sp = await searchParams;
  const filter = pickParam(sp.filter, PASS_FILTERS, "active");
  const { q, page } = parseListParams(sp);
  const [plans, { passes, total }] = await Promise.all([listPlans(club.id), listPasses(club.id, { filter, q, page })]);
  const writable = !access.readOnly;
  const money = (n: number) => formatMoney(n, club.currency);
  const base = `/dashboard/${club.slug}/memberships`;
  const now = Date.now();
  const onSale = plans.filter((p) => p.isActive);

  return (
    <div className="space-y-8">
      <PageHeader title="Memberships & passes" description="Plans you sell, and every member's pass with its credits and expiry." />

      <section aria-labelledby="plans-heading" className="space-y-4">
        <h2 id="plans-heading" className="text-lg font-semibold">
          Plans
        </h2>
        {plans.length === 0 ? (
          <EmptyState>No plans yet. Create a monthly membership or a session pass below.</EmptyState>
        ) : (
          <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {plans.map((p) => (
              <li key={p.id} className="min-w-0">
                <PlanCard plan={p} access={access} money={money} writable={writable} />
              </li>
            ))}
          </ul>
        )}
        {writable && (
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <Panel title="Create a plan">
              <PlanForm access={access} />
            </Panel>
            <Panel title="Sell a pass">
              {onSale.length === 0 ? (
                <EmptyState>Put a plan on sale to sell passes.</EmptyState>
              ) : (
                <ActionForm action={sellPass} hidden={{ clubSlug: club.slug }} label="Sell a pass" className="space-y-4 p-5">
                  <SelectField name="planId" label="Plan" options={onSale.map((p) => ({ value: p.id, label: `${p.name} · ${money(p.priceAmount)}` }))} />
                  <Field name="email" label="Member email" type="email" autoComplete="off" hint="They need a nexport account; they join the club as a member." />
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field name="startDate" label="Starts" type="date" defaultValue={zonedParts(new Date(), club.timezone).dateKey} />
                    <SelectField name="paymentMethod" label="Payment" options={paymentOptions} />
                  </div>
                  <FormFooter submit="Sell pass" pendingLabel="Selling…" />
                </ActionForm>
              )}
            </Panel>
          </div>
        )}
      </section>

      <section aria-labelledby="passes-heading" className="space-y-4">
        <h2 id="passes-heading" className="text-lg font-semibold">
          Members&apos; passes
        </h2>
        <nav aria-label="Pass filter" className="flex flex-wrap gap-2">
          {PASS_FILTERS.map((f) => (
            <Link
              key={f}
              href={`${base}?${new URLSearchParams({ filter: f, ...(q ? { q } : {}) })}` as Route}
              aria-current={filter === f ? "page" : undefined}
              className={cn("rounded-full px-4 py-1.5 text-sm font-medium", filter === f ? "bg-ink text-ink-foreground" : "text-muted-foreground hover:bg-muted")}
            >
              {filterLabels[f]}
            </Link>
          ))}
        </nav>
        <form role="search" action={base} className="flex flex-wrap gap-2">
          <input type="hidden" name="filter" value={filter} />
          <label className="min-w-0 flex-1 basis-60">
            <span className="sr-only">Member name or email</span>
            <input type="search" name="q" defaultValue={q} maxLength={100} placeholder="Member name or email" className="h-10 w-full rounded-full border border-border bg-card px-4 text-sm" />
          </label>
          <button type="submit" className="h-10 rounded-full bg-ink px-5 text-sm font-semibold text-ink-foreground">
            Search
          </button>
        </form>
        <Panel title={`${total} ${total === 1 ? "pass" : "passes"}`}>
          {passes.length === 0 ? (
            <EmptyState>No passes match.</EmptyState>
          ) : (
            <TableWrap>
              <table className="w-full min-w-[760px]">
                <thead className="border-b border-border">
                  <tr>
                    <th scope="col" className={th}>Member</th>
                    <th scope="col" className={th}>Plan</th>
                    <th scope="col" className={th}>Credits left</th>
                    <th scope="col" className={th}>Valid</th>
                    <th scope="col" className={th}>Status</th>
                    {writable && <th scope="col" className={th}><span className="sr-only">Actions</span></th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {passes.map((p) => {
                    const state = passState(p, now);
                    const left = p.creditsTotal === null ? null : p.creditsTotal - p.creditsUsed;
                    return (
                      <tr key={p.id}>
                        <td className={td}>
                          <p className="font-medium">{p.holderName ?? p.holderEmail}</p>
                          <p className="text-xs text-muted-foreground">{p.holderEmail}</p>
                        </td>
                        <td className={td}>{p.planName}</td>
                        <td className={`${td} tabular-nums`}>
                          {left === null ? (
                            "Unlimited"
                          ) : (
                            <span className="flex items-center gap-2">
                              <span className="h-1.5 w-16 rounded-full bg-muted" aria-hidden>
                                <span className="block h-full rounded-full bg-chart-1" style={{ width: `${(left / p.creditsTotal!) * 100}%` }} />
                              </span>
                              {left} of {p.creditsTotal}
                            </span>
                          )}
                        </td>
                        <td className={`${td} whitespace-nowrap text-xs`}>
                          {formatDate(p.startsAt, club.timezone)} → {formatDate(p.expiresAt, club.timezone)}
                        </td>
                        <td className={td}>
                          <Badge variant={state.variant}>{state.label}</Badge>
                        </td>
                        {writable && (
                          <td className={`${td} text-right`}>
                            {state.label === "Active" && (
                              <span className="inline-flex flex-wrap justify-end gap-2">
                                {left !== null && (
                                  <ActionButton action={redeemCredit} hidden={{ clubSlug: club.slug, passId: p.id }} variant="primary">
                                    Use 1 credit
                                  </ActionButton>
                                )}
                                <ActionButton action={cancelPass} hidden={{ clubSlug: club.slug, passId: p.id }} variant="ghost" confirm="Cancel this pass? The member loses access immediately.">
                                  Cancel
                                </ActionButton>
                              </span>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
          <Pagination basePath={base} params={{ filter, q }} page={page} total={total} />
        </Panel>
      </section>
    </div>
  );
}

function PlanCard({ plan: p, access, money, writable }: { plan: Plan; access: ClubAccess; money: (n: number) => string; writable: boolean }) {
  return (
    <Panel
      title={p.name}
      action={
        <span className="flex items-center gap-2">
          <Badge variant={p.isActive ? "success" : "outline"}>{p.isActive ? "On sale" : "Withdrawn"}</Badge>
          {writable && (
            <ActionButton action={setPlanActive} hidden={{ clubSlug: access.club.slug, planId: p.id, active: String(!p.isActive) }}>
              {p.isActive ? "Withdraw" : "Put on sale"}
            </ActionButton>
          )}
        </span>
      }
    >
      <div className="space-y-2 p-5 text-sm">
        <p className="text-2xl font-semibold tabular-nums">{money(p.priceAmount)}</p>
        <p className="text-muted-foreground">
          {p.kind === "CREDITS" ? `${p.creditCount} sessions, valid ${p.durationDays} days` : `Unlimited access for ${p.durationDays} days`}
        </p>
        {p.description && <p>{p.description}</p>}
        <p className="text-xs text-muted-foreground">
          {p.activePasses} active {p.activePasses === 1 ? "pass" : "passes"} · {p.sold} sold
        </p>
      </div>
      {writable && (
        <details className="border-t border-border px-5 py-3">
          <summary className="cursor-pointer text-sm font-medium text-accent-text">Edit plan</summary>
          <PlanForm access={access} plan={p} />
        </details>
      )}
    </Panel>
  );
}

function PlanForm({ access, plan }: { access: ClubAccess; plan?: Plan }) {
  return (
    <ActionForm action={savePlan} hidden={{ clubSlug: access.club.slug, ...(plan ? { planId: plan.id } : {}) }} label={plan ? `Edit ${plan.name}` : "Create a plan"} className="space-y-4 p-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field name="name" label="Name" defaultValue={plan?.name} placeholder="10-Session Punch Card" maxLength={60} />
        <SelectField name="kind" label="Type" options={kindOptions} defaultValue={plan?.kind ?? "CREDITS"} />
        <Field name="price" label={`Price (${access.club.currency.toUpperCase()})`} defaultValue={plan ? centsToInput(plan.priceAmount) : ""} inputMode="decimal" placeholder="90" />
        <Field name="durationDays" label="Valid for (days)" defaultValue={plan ? String(plan.durationDays) : "30"} inputMode="numeric" />
        <Field name="creditCount" label="Sessions included" defaultValue={plan?.creditCount?.toString() ?? ""} inputMode="numeric" hint="Session passes only; blank for unlimited" />
        <Field name="description" label="Description" defaultValue={plan?.description ?? ""} maxLength={300} hint="Optional" />
      </div>
      {plan && <p className="text-xs text-muted-foreground">Changes apply to passes sold from now on.</p>}
      <FormFooter submit={plan ? "Save plan" : "Create plan"} />
    </ActionForm>
  );
}
