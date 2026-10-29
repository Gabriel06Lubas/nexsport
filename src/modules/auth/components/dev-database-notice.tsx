import type { DbHealth } from "@/db/health";

/** Development only: what to run when the database isn't ready. */
export function DevDatabaseNotice({ health }: { health: Exclude<DbHealth, { ok: true }> }) {
  const code = "rounded bg-black/5 px-1 py-0.5 font-mono text-xs dark:bg-white/10";
  return (
    <div role="alert" className="mt-5 rounded-xl bg-warning-soft p-3 text-sm text-warning">
      <p className="font-semibold">Development: the database isn’t ready</p>
      {health.problem === "unreachable" && (
        <p className="mt-1">
          Can’t connect ({health.detail}). Start it with <code className={code}>npm run db:up</code> in another terminal, and check{" "}
          <code className={code}>DATABASE_URL</code> in <code className={code}>.env</code>.
        </p>
      )}
      {health.problem === "not_migrated" && (
        <p className="mt-1">
          No tables yet. Run <code className={code}>npm run db:migrate</code>.
        </p>
      )}
      {health.problem === "migrations_pending" && (
        <p className="mt-1">
          {health.pending} {health.pending === 1 ? "migration hasn’t" : "migrations haven’t"} been applied. Run{" "}
          <code className={code}>npm run db:migrate</code>.
        </p>
      )}
    </div>
  );
}
