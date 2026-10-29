import { Search } from "lucide-react";
import type { Metadata } from "next";

import { TenantActions } from "@/modules/admin/components/tenant-actions";
import {
  ConnectBadge,
  EmptyState,
  formatDate,
  PageHeader,
  Pagination,
  Panel,
  StatusBadge,
  TableWrap,
  td,
  th,
  TierBadge,
} from "@/modules/admin/components/ui";
import { parseListParams, pickParam } from "@/modules/admin/lib/params";
import { listTenants } from "@/modules/admin/queries";
import { requireAdmin } from "@/modules/auth/dal";

export const metadata: Metadata = { title: "Tenants & Clubs" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const TYPES = ["all", "club", "coach"] as const;

export default async function TenantsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const params = await searchParams;
  const { q, page } = parseListParams(params);
  const type = pickParam(params.type, TYPES, "all");
  const { tenants, total } = await listTenants({ q, type, page });

  return (
    <div className="space-y-6">
      <PageHeader title="Tenants & clubs" description="Every club and independent coach on the platform." />

      <form role="search" className="flex flex-wrap gap-2" action="/admin/tenants">
        <label className="relative min-w-0 flex-1 basis-60">
          <span className="sr-only">Search by name or owner email</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            type="search"
            name="q"
            defaultValue={q}
            maxLength={100}
            placeholder="Search by name or owner email"
            className="h-10 w-full rounded-full border border-border bg-card pl-9 pr-4 text-sm"
          />
        </label>
        <label>
          <span className="sr-only">Tenant type</span>
          <select name="type" defaultValue={type} className="h-10 rounded-full border border-border bg-card px-4 text-sm">
            <option value="all">All tenants</option>
            <option value="club">Clubs</option>
            <option value="coach">Independent coaches</option>
          </select>
        </label>
        <button type="submit" className="h-10 rounded-full bg-ink px-5 text-sm font-semibold text-ink-foreground">
          Search
        </button>
      </form>

      <Panel title={`${total} ${total === 1 ? "tenant" : "tenants"}`}>
        {tenants.length === 0 ? (
          <EmptyState>{q ? `No tenants match “${q}”.` : "No tenants yet."}</EmptyState>
        ) : (
          <TableWrap>
            <table className="w-full min-w-[920px]">
              <thead className="border-b border-border">
                <tr>
                  <th scope="col" className={th}>Club / coach</th>
                  <th scope="col" className={th}>Owner email</th>
                  <th scope="col" className={th}>Plan</th>
                  <th scope="col" className={th}>Facilities</th>
                  <th scope="col" className={th}>Stripe Connect</th>
                  <th scope="col" className={th}>Created</th>
                  <th scope="col" className={th}><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {tenants.map((t) => (
                  <tr key={`${t.kind}-${t.id}`} className="hover:bg-muted/40">
                    <td className={td}>
                      <span className="block font-medium">{t.name}</span>
                      <span className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                        {t.kind === "club" ? "Club" : "Coach"}
                        {t.status !== "ACTIVE" && <StatusBadge status={t.status} />}
                      </span>
                    </td>
                    <td className={`${td} text-muted-foreground`}>{t.ownerEmail}</td>
                    <td className={td}>
                      <TierBadge tier={t.tier} />
                    </td>
                    <td className={`${td} tabular-nums`}>{t.facilities ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className={td}>
                      <ConnectBadge status={t.connectStatus} chargesEnabled={t.chargesEnabled} payoutsEnabled={t.payoutsEnabled} />
                    </td>
                    <td className={`${td} whitespace-nowrap text-muted-foreground`}>{formatDate(t.createdAt)}</td>
                    <td className={`${td} text-right`}>
                      <TenantActions kind={t.kind} id={t.id} name={t.name} suspended={t.status === "SUSPENDED"} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        <Pagination basePath="/admin/tenants" params={{ q, type }} page={page} total={total} />
      </Panel>
    </div>
  );
}
