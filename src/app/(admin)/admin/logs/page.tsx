import type { Metadata, Route } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { EmptyState, formatDateTime, PageHeader, Pagination, Panel, TableWrap, td, th } from "@/components/dashboard/ui";
import { parseListParams, pickParam } from "@/lib/list-params";
import { listAuditLog, listWebhookEvents } from "@/modules/admin/queries";
import { requireAdmin } from "@/modules/auth/dal";

export const metadata: Metadata = { title: "System Logs & Webhooks" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const TABS = ["webhooks", "audit"] as const;
const STATUSES = ["all", "failed", "pending"] as const;

const actionLabel: Record<string, string> = {
  PLAN_UPDATED: "Plan updated",
  TENANT_SUSPENDED: "Tenant suspended",
  TENANT_REACTIVATED: "Tenant reactivated",
  IMPERSONATION_STARTED: "Impersonation started",
  IMPERSONATION_ENDED: "Impersonation ended",
};

function targetHref(type: string, id: string): Route | null {
  if (type === "club" || type === "coach") return `/admin/tenants/${type}/${id}` as Route;
  if (type === "plan") return "/admin/subscriptions";
  return null;
}

export default async function LogsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const params = await searchParams;
  const tab = pickParam(params.tab, TABS, "webhooks");
  const { q, page } = parseListParams(params);
  const status = pickParam(params.status, STATUSES, "all");

  const tabLink = (t: (typeof TABS)[number], label: string) => (
    <Link
      href={`/admin/logs?tab=${t}` as Route}
      aria-current={tab === t ? "page" : undefined}
      className={cn("rounded-full px-4 py-1.5 text-sm font-medium", tab === t ? "bg-ink text-ink-foreground" : "text-muted-foreground hover:bg-muted")}
    >
      {label}
    </Link>
  );

  return (
    <div className="space-y-6">
      <PageHeader title="System logs & webhooks" description="Stripe webhook deliveries and every action taken by an admin." />
      <nav aria-label="Log type" className="flex gap-2">
        {tabLink("webhooks", "Stripe webhooks")}
        {tabLink("audit", "Admin audit log")}
      </nav>

      {tab === "webhooks" ? <Webhooks q={q} status={status} page={page} /> : <AuditLog page={page} />}
    </div>
  );
}

async function Webhooks({ q, status, page }: { q: string; status: (typeof STATUSES)[number]; page: number }) {
  const { events, total } = await listWebhookEvents({ q, status, page });
  return (
    <>
      <form role="search" action="/admin/logs" className="flex flex-wrap gap-2">
        <input type="hidden" name="tab" value="webhooks" />
        <label className="min-w-0 flex-1 basis-60">
          <span className="sr-only">Event type or id</span>
          <input
            type="search"
            name="q"
            defaultValue={q}
            maxLength={100}
            placeholder="Event type or id, e.g. charge.dispute"
            className="h-10 w-full rounded-full border border-border bg-card px-4 text-sm"
          />
        </label>
        <label>
          <span className="sr-only">Status</span>
          <select name="status" defaultValue={status} className="h-10 rounded-full border border-border bg-card px-4 text-sm">
            <option value="all">All events</option>
            <option value="failed">Failed</option>
            <option value="pending">Not processed</option>
          </select>
        </label>
        <button type="submit" className="h-10 rounded-full bg-ink px-5 text-sm font-semibold text-ink-foreground">
          Filter
        </button>
      </form>
      <Panel title={`${total} ${total === 1 ? "event" : "events"}`}>
        {events.length === 0 ? (
          <EmptyState>No webhook events match.</EmptyState>
        ) : (
          <TableWrap>
            <table className="w-full min-w-[720px]">
              <thead className="border-b border-border">
                <tr>
                  <th scope="col" className={th}>Received</th>
                  <th scope="col" className={th}>Type</th>
                  <th scope="col" className={th}>Event id</th>
                  <th scope="col" className={th}>Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {events.map((e) => (
                  <tr key={e.id}>
                    <td className={`${td} whitespace-nowrap`}>{formatDateTime(e.createdAt)}</td>
                    <td className={`${td} font-mono text-xs`}>
                      {e.type}
                      {!e.livemode && <Badge variant="outline" className="ml-2">test</Badge>}
                    </td>
                    <td className={`${td} font-mono text-xs text-muted-foreground`}>{e.id}</td>
                    <td className={td}>
                      {e.error ? (
                        <span>
                          <Badge variant="danger">Failed</Badge>
                          <span className="mt-1 block max-w-xs truncate text-xs text-danger" title={e.error}>
                            {e.error}
                          </span>
                        </span>
                      ) : e.processedAt ? (
                        <Badge variant="success">Processed</Badge>
                      ) : (
                        <Badge variant="warning">Pending</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        <Pagination basePath="/admin/logs" params={{ tab: "webhooks", q, status }} page={page} total={total} />
      </Panel>
    </>
  );
}

async function AuditLog({ page }: { page: number }) {
  const { entries, total } = await listAuditLog({ page });
  return (
    <Panel title={`${total} admin ${total === 1 ? "action" : "actions"}`}>
      {entries.length === 0 ? (
        <EmptyState>No admin actions yet.</EmptyState>
      ) : (
        <ul className="divide-y divide-border">
          {entries.map((e) => {
            const href = targetHref(e.targetType, e.targetId);
            return (
              <li key={e.id} className="px-5 py-3 text-sm">
                <p>
                  <span className="font-medium">{actionLabel[e.action] ?? e.action}</span>
                  {" · "}
                  {href ? (
                    <Link href={href} className="text-accent-text hover:underline">
                      {e.targetLabel ?? e.targetId}
                    </Link>
                  ) : (
                    (e.targetLabel ?? e.targetId)
                  )}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {formatDateTime(e.createdAt)} · by {e.actorEmail}
                  {e.reason && <> · “{e.reason}”</>}
                </p>
                {e.action === "PLAN_UPDATED" && e.details != null && (
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    {Object.entries(e.details as Record<string, { from: unknown; to: unknown }>)
                      .map(([k, v]) => `${k}: ${JSON.stringify(v.from)} → ${JSON.stringify(v.to)}`)
                      .join(" · ")}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <Pagination basePath="/admin/logs" params={{ tab: "audit" }} page={page} total={total} />
    </Panel>
  );
}
