import { UserRoundCog } from "lucide-react";

import { getImpersonation, type CurrentUser } from "@/modules/auth/dal";

import { stopImpersonatingAction } from "../actions";

const time = new Intl.DateTimeFormat("en-GB", { timeStyle: "short", timeZone: "UTC" });

/** Shown on every app page while an admin is impersonating this account. */
export async function ImpersonationBanner({ user }: { user: CurrentUser | null }) {
  const impersonation = await getImpersonation();
  if (!impersonation || !user) return null;
  return (
    <div role="status" className="bg-warning text-white dark:text-black">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 text-sm sm:px-6">
        <UserRoundCog className="size-4 shrink-0" aria-hidden />
        <p className="min-w-0 flex-1">
          <strong>Impersonating {user.name ?? user.email}</strong> ({user.email}) as {impersonation.adminEmail}. Ends at{" "}
          {time.format(impersonation.expires)} UTC. Account-security changes are disabled.
        </p>
        <form action={stopImpersonatingAction}>
          <button type="submit" className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-black hover:bg-white/90">
            Stop impersonating
          </button>
        </form>
      </div>
    </div>
  );
}
