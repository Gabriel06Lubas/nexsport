import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import type { Metadata, Route } from "next";
import Link from "next/link";

import { EmptyState, PageHeader, Panel, TableWrap, td, th } from "@/components/dashboard/ui";
import { ActionButton, ActionForm, CheckboxGroup, Field, FormFooter, SelectField } from "@/components/forms/action-form";
import { Badge } from "@/components/ui/badge";
import { bpsToInput, centsToInput, formatBps } from "@/lib/money-input";
import { formatMoney } from "@/lib/utils";
import { addStaffMember, removeFromRoster, setPermissions, updatePay } from "@/modules/clubs/actions/staff";
import { can, requireClubSection, type ClubAccess } from "@/modules/clubs/dal";
import { monthSchema } from "@/modules/clubs/lib/forms";
import { allClubPermissions, permissionLabels } from "@/modules/clubs/lib/permissions";
import { addDays } from "@/modules/clubs/lib/zoned-time";
import { currentMonth, getPayroll, listRoster, payrollLookup, previousMonth, wagesDue, type RosterMember } from "@/modules/clubs/queries/staff";

export const metadata: Metadata = { title: "Staff & Payroll" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const monthTitle = (month: string) => new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
const nextMonth = (month: string) => addDays(`${month}-28`, 7).slice(0, 7);
const employmentOptions = [
  { value: "FREELANCE", label: "Freelance (commission)" },
  { value: "EMPLOYEE", label: "Employee (hourly wage)" },
];

export default async function StaffPage({ params, searchParams }: { params: Promise<{ clubSlug: string }>; searchParams: SearchParams }) {
  const { clubSlug } = await params;
  const access = await requireClubSection(clubSlug, "staff");
  const { club } = access;
  const raw = (await searchParams).month;
  const thisMonth = currentMonth(club.timezone);
  const month = monthSchema.safeParse(raw).success && (raw as string) <= thisMonth ? (raw as string) : thisMonth;
  const [roster, payroll] = await Promise.all([listRoster(club.id), getPayroll(club, month)]);
  const lineFor = payrollLookup(roster, payroll);
  const billing = can(access, "MANAGE_BILLING");
  const members = can(access, "MANAGE_MEMBERS");
  const owner = access.role === "OWNER";
  const writable = !access.readOnly;
  const money = (n: number) => formatMoney(n, club.currency);
  const base = `/dashboard/${club.slug}/staff`;

  const payable = roster.filter((m) => m.role !== "OWNER" || lineFor(m));
  const totals = payable.reduce(
    (t, m) => {
      const p = lineFor(m);
      t.hours += p?.hours ?? 0;
      t.gross += p?.gross ?? 0;
      t.coach += (p?.coachPaid ?? 0) + (p?.coachPending ?? 0);
      t.club += p?.clubShare ?? 0;
      t.wages += m.employmentType === "EMPLOYEE" ? wagesDue(p?.hours ?? 0, m.hourlyWageAmount) : 0;
      return t;
    },
    { hours: 0, gross: 0, coach: 0, club: 0, wages: 0 },
  );

  return (
    <div className="space-y-8">
      <PageHeader title="Staff & payroll" description="Your front-desk team and coaches, their billable hours, and how session revenue is split through Stripe Connect.">
        <nav aria-label="Month" className="flex items-center gap-2">
          <Link href={`${base}?month=${previousMonth(month)}` as Route} className="inline-flex size-9 items-center justify-center rounded-full border border-border hover:bg-muted" aria-label="Previous month">
            <ChevronLeft className="size-4" aria-hidden />
          </Link>
          <span className="text-sm font-semibold">{monthTitle(month)}</span>
          {month < thisMonth ? (
            <Link href={`${base}?month=${nextMonth(month)}` as Route} className="inline-flex size-9 items-center justify-center rounded-full border border-border hover:bg-muted" aria-label="Next month">
              <ChevronRight className="size-4" aria-hidden />
            </Link>
          ) : (
            <span className="size-9" />
          )}
        </nav>
      </PageHeader>

      <Panel title={`Roster (${roster.length})`}>
        {roster.length === 0 ? (
          <EmptyState>No staff or coaches yet.</EmptyState>
        ) : (
          <TableWrap>
            <table className="w-full min-w-[820px]">
              <thead className="border-b border-border">
                <tr>
                  <th scope="col" className={th}>Person</th>
                  <th scope="col" className={th}>Role</th>
                  {billing && <th scope="col" className={th}>Pay terms</th>}
                  <th scope="col" className={th}>Stripe Connect</th>
                  <th scope="col" className={th}>Hours ({monthTitle(month)})</th>
                  <th scope="col" className={th}><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {roster.map((m) => {
                  const p = lineFor(m);
                  return (
                    <tr key={m.id}>
                      <td className={td}>
                        <p className="font-medium">{m.name ?? m.email}</p>
                        <p className="text-xs text-muted-foreground">{m.email}</p>
                      </td>
                      <td className={td}>
                        <Badge variant={m.role === "OWNER" ? "lime" : m.role === "STAFF" ? "neutral" : "outline"}>{m.role === "OWNER" ? "Owner" : m.role === "STAFF" ? "Staff" : "Coach"}</Badge>
                        {m.title && <span className="mt-1 block text-xs text-muted-foreground">{m.title}</span>}
                        {m.role === "STAFF" && (
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {m.permissions.length === 0 ? "No permissions yet" : `${m.permissions.length} ${m.permissions.length === 1 ? "permission" : "permissions"}`}
                          </span>
                        )}
                      </td>
                      {billing && (
                        <td className={`${td} text-xs`}>
                          {m.role === "OWNER"
                            ? "—"
                            : m.employmentType === "EMPLOYEE"
                              ? `Employee · ${m.hourlyWageAmount === null ? "no wage set" : `${money(m.hourlyWageAmount)}/h`}`
                              : m.employmentType === "FREELANCE"
                                ? `Freelance · ${m.commissionBps === null ? "no commission set" : `${formatBps(m.commissionBps)} commission`}`
                                : "Not set"}
                        </td>
                      )}
                      <td className={td}>
                        {m.role === "COACH" && m.employmentType !== "EMPLOYEE" ? (
                          m.payoutsEnabled ? <Badge variant="success">Payouts on</Badge> : m.connectStatus ? <Badge variant="warning">Onboarding</Badge> : <Badge variant="outline">Not connected</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className={`${td} tabular-nums`}>
                        {p ? `${p.hours.toFixed(1)} h · ${p.sessions} ${p.sessions === 1 ? "session" : "sessions"}` : "—"}
                      </td>
                      <td className={`${td} text-right`}>
                        {writable && m.role !== "OWNER" && <MemberActions member={m} access={access} canPay={billing} canRemove={m.role === "STAFF" ? owner : members} owner={owner} />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Panel>

      {billing && (
        <Panel
          title={`Payout report · ${monthTitle(month)}`}
          action={
            <a href={`${base}/payout-report?month=${month}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-accent-text hover:underline" download>
              <Download className="size-4" aria-hidden /> CSV
            </a>
          }
        >
          {payable.length === 0 ? (
            <EmptyState>Nobody to pay this month.</EmptyState>
          ) : (
            <TableWrap>
              <table className="w-full min-w-[880px]">
                <thead className="border-b border-border">
                  <tr>
                    <th scope="col" className={th}>Person</th>
                    <th scope="col" className={th}>Billable hours</th>
                    <th scope="col" className={th}>Session revenue</th>
                    <th scope="col" className={th}>Coach split (Stripe)</th>
                    <th scope="col" className={th}>Club split (Stripe)</th>
                    <th scope="col" className={th}>Wages due</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border tabular-nums">
                  {payable.map((m) => {
                    const p = lineFor(m);
                    const wages = m.employmentType === "EMPLOYEE" ? wagesDue(p?.hours ?? 0, m.hourlyWageAmount) : 0;
                    return (
                      <tr key={m.id}>
                        <td className={td}>
                          <p className="font-medium">{m.name ?? m.email}</p>
                          <p className="text-xs text-muted-foreground">{m.employmentType === "EMPLOYEE" ? "Employee" : m.employmentType === "FREELANCE" ? "Freelance" : m.role === "OWNER" ? "Owner" : "Pay terms not set"}</p>
                        </td>
                        <td className={td}>{(p?.hours ?? 0).toFixed(1)} h</td>
                        <td className={td}>{money(p?.gross ?? 0)}</td>
                        <td className={td}>
                          {money((p?.coachPaid ?? 0) + (p?.coachPending ?? 0))}
                          {(p?.coachPending ?? 0) > 0 && <span className="block text-xs text-warning">{money(p!.coachPending)} pending</span>}
                          {(p?.coachFailed ?? 0) > 0 && <span className="block text-xs text-danger">{money(p!.coachFailed)} failed</span>}
                        </td>
                        <td className={td}>{money(p?.clubShare ?? 0)}</td>
                        <td className={`${td} font-medium`}>{m.employmentType === "EMPLOYEE" ? money(wages) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="border-t border-border font-medium tabular-nums">
                  <tr>
                    <th scope="row" className={`${td} text-left`}>Total</th>
                    <td className={td}>{totals.hours.toFixed(1)} h</td>
                    <td className={td}>{money(totals.gross)}</td>
                    <td className={td}>{money(totals.coach)}</td>
                    <td className={td}>{money(totals.club)}</td>
                    <td className={td}>{money(totals.wages)}</td>
                  </tr>
                </tfoot>
              </table>
            </TableWrap>
          )}
          <p className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
            Freelance coaches are paid automatically: each session payment is split by Stripe Connect into the coach&apos;s and the club&apos;s accounts.
            Employees&apos; wages (billable hours × hourly wage) are paid through your own payroll.
          </p>
        </Panel>
      )}

      {writable && members && (
        <Panel title="Add to the roster">
          <ActionForm action={addStaffMember} hidden={{ clubSlug: club.slug }} label="Add to the roster" className="space-y-4 p-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field name="email" label="Email" type="email" autoComplete="off" hint="They need a nexport account" />
              <SelectField
                name="role"
                label="Role"
                options={owner ? [{ value: "COACH", label: "Coach" }, { value: "STAFF", label: "Staff (dashboard access)" }] : [{ value: "COACH", label: "Coach" }]}
              />
              <Field name="title" label="Job title" placeholder="Head Coach" maxLength={60} hint="Optional" />
              {billing && (
                <>
                  <SelectField name="employmentType" label="Employment" options={employmentOptions} />
                  <Field name="hourlyWage" label={`Hourly wage (${club.currency.toUpperCase()})`} inputMode="decimal" hint="Employees" />
                  <Field name="commission" label="Commission (%)" inputMode="decimal" placeholder="70" hint="Freelancers: their share of session revenue" />
                </>
              )}
            </div>
            <FormFooter submit="Add" pendingLabel="Adding…" />
          </ActionForm>
        </Panel>
      )}
    </div>
  );
}

function MemberActions({ member: m, access, canPay, canRemove, owner }: { member: RosterMember; access: ClubAccess; canPay: boolean; canRemove: boolean; owner: boolean }) {
  const slug = access.club.slug;
  if (!canPay && !canRemove && !(owner && m.role === "STAFF")) return null;
  return (
    <details className="inline-block text-left">
      <summary className="cursor-pointer whitespace-nowrap text-sm font-medium text-accent-text">Manage</summary>
      <div className="mt-3 w-[min(80vw,22rem)] space-y-5">
        {owner && m.role === "STAFF" && (
          <ActionForm action={setPermissions} hidden={{ clubSlug: slug, memberId: m.id }} label={`Permissions for ${m.name ?? m.email}`} className="space-y-3">
            <CheckboxGroup
              name="permissions"
              legend="Permissions"
              options={allClubPermissions.map((p) => ({ value: p, label: permissionLabels[p] }))}
              defaultValues={m.permissions}
            />
            <FormFooter submit="Save permissions" />
          </ActionForm>
        )}
        {canPay && (
          <ActionForm action={updatePay} hidden={{ clubSlug: slug, memberId: m.id }} label={`Pay terms for ${m.name ?? m.email}`} className="space-y-3">
            <p className="text-sm font-medium">Pay terms</p>
            <Field name="title" label="Job title" defaultValue={m.title ?? ""} maxLength={60} />
            <SelectField name="employmentType" label="Employment" options={employmentOptions} defaultValue={m.employmentType ?? "FREELANCE"} />
            <Field name="hourlyWage" label="Hourly wage" defaultValue={m.hourlyWageAmount === null ? "" : centsToInput(m.hourlyWageAmount)} inputMode="decimal" />
            <Field name="commission" label="Commission (%)" defaultValue={m.commissionBps === null ? "" : bpsToInput(m.commissionBps)} inputMode="decimal" />
            <FormFooter submit="Save pay terms" />
          </ActionForm>
        )}
        {canRemove && (
          <ActionButton
            action={removeFromRoster}
            hidden={{ clubSlug: slug, memberId: m.id, role: m.role }}
            variant="ghost"
            confirm={`Remove ${m.name ?? m.email} from the roster?${m.role === "STAFF" ? " Their dashboard access ends immediately." : ""}`}
          >
            Remove from roster
          </ActionButton>
        )}
      </div>
    </details>
  );
}
