import { and, desc, eq, gt } from "drizzle-orm";
import { Laptop, LogOut, Smartphone } from "lucide-react";
import type { Metadata } from "next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { db } from "@/db";
import { account, session } from "@/db/schema";
import {
  revokeSession,
  signInWithProvider,
  signOutEverywhere,
  signOutOtherDevices,
  unlinkProvider,
} from "@/modules/auth/actions";
import { AppleIcon, GoogleIcon } from "@/modules/auth/components/provider-icons";
import { getCurrentSessionTokenHash, requireUser } from "@/modules/auth/dal";
import { SESSION_ABSOLUTE_LIFETIME_SECONDS, SESSION_IDLE_TIMEOUT_SECONDS } from "@/modules/auth/lib/session-policy";
import { describeUserAgent } from "@/modules/auth/lib/user-agent";
import { configuredProviderIds, providerLabels, type ProviderId } from "@/modules/auth/providers";

export const metadata: Metadata = { title: "Security & devices" };

const notices: Record<string, { tone: "success" | "danger"; text: string }> = {
  "revoked=one": { tone: "success", text: "That device has been signed out." },
  "revoked=others": { tone: "success", text: "All your other devices have been signed out." },
  "unlinked=1": { tone: "success", text: "The account was disconnected." },
  "error=last-provider": { tone: "danger", text: "You can't disconnect your only sign-in method. Connect another one first." },
};

const icons: Record<ProviderId, typeof GoogleIcon> = { google: GoogleIcon, apple: AppleIcon };

const dateTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function SecurityPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const params = await searchParams;
  const [sessions, accounts, currentHash] = await Promise.all([
    db
      .select({
        id: session.id,
        tokenHash: session.tokenHash,
        userAgent: session.userAgent,
        createdAt: session.createdAt,
        lastSeenAt: session.lastSeenAt,
      })
      .from(session)
      .where(and(eq(session.userId, user.id), gt(session.expires, new Date())))
      .orderBy(desc(session.lastSeenAt)),
    db.select({ provider: account.provider }).from(account).where(eq(account.userId, user.id)),
    getCurrentSessionTokenHash(),
  ]);

  const notice = Object.entries(notices).find(([key]) => {
    const [k, v] = key.split("=");
    return params[k!] === v;
  })?.[1];
  const linked = new Set(accounts.map((a) => a.provider));
  const available = configuredProviderIds();
  const days = (s: number) => Math.round(s / 86_400);

  return (
    <div className="max-w-3xl">
      <h1 className="text-3xl font-semibold tracking-tight">Security & devices</h1>
      <p className="mt-2 text-muted-foreground">
        Where you’re signed in and how you sign in. Sessions end after {days(SESSION_IDLE_TIMEOUT_SECONDS)} days without
        activity, and after {days(SESSION_ABSOLUTE_LIFETIME_SECONDS)} days at most.
      </p>

      {notice && (
        <p role="status" className={notice.tone === "success" ? "mt-6 rounded-xl bg-success-soft p-3 text-sm text-success" : "mt-6 rounded-xl bg-danger-soft p-3 text-sm text-danger"}>
          {notice.text}
        </p>
      )}

      <section aria-labelledby="devices" className="mt-10">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="devices" className="text-lg font-semibold">
            Your devices
          </h2>
          {sessions.length > 1 && (
            <form action={signOutOtherDevices}>
              <Button type="submit" variant="outline" size="sm">
                Sign out all other devices
              </Button>
            </form>
          )}
        </div>
        <ul className="mt-4 divide-y divide-border rounded-2xl border border-border bg-card">
          {sessions.map((s) => {
            const isCurrent = s.tokenHash === currentHash;
            const label = describeUserAgent(s.userAgent);
            const Icon = /iPhone|Android|iPad/.test(label) ? Smartphone : Laptop;
            return (
              <li key={s.id} className="flex flex-wrap items-center gap-4 p-4">
                <Icon className="size-5 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    {label} {isCurrent && <Badge variant="lime">This device</Badge>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Signed in {dateTime.format(s.createdAt)} UTC · last active {dateTime.format(s.lastSeenAt)} UTC
                  </p>
                </div>
                {!isCurrent && (
                  <form action={revokeSession}>
                    <input type="hidden" name="sessionId" value={s.id} />
                    <Button type="submit" variant="ghost" size="sm">
                      Sign out
                    </Button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="accounts" className="mt-10">
        <h2 id="accounts" className="text-lg font-semibold">
          Sign-in methods
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">Connect both to sign in either way. Your password stays with Google or Apple.</p>
        <ul className="mt-4 divide-y divide-border rounded-2xl border border-border bg-card">
          {(["google", "apple"] as const)
            .filter((p) => linked.has(p) || available.includes(p))
            .map((provider) => {
              const Icon = icons[provider];
              const isLinked = linked.has(provider);
              return (
                <li key={provider} className="flex items-center gap-4 p-4">
                  <Icon className="size-5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">{providerLabels[provider]}</p>
                    <p className="text-xs text-muted-foreground">{isLinked ? "Connected" : "Not connected"}</p>
                  </div>
                  {isLinked ? (
                    <form action={unlinkProvider}>
                      <input type="hidden" name="provider" value={provider} />
                      <Button type="submit" variant="ghost" size="sm" disabled={linked.size <= 1} title={linked.size <= 1 ? "Your only sign-in method" : undefined}>
                        Disconnect
                      </Button>
                    </form>
                  ) : (
                    <form action={signInWithProvider.bind(null, provider, "/dashboard/settings/security")}>
                      <Button type="submit" variant="outline" size="sm">
                        Connect
                      </Button>
                    </form>
                  )}
                </li>
              );
            })}
        </ul>
      </section>

      <section aria-labelledby="everywhere" className="mt-10 rounded-2xl border border-danger/30 p-5">
        <h2 id="everywhere" className="font-semibold">
          Lost a device?
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">Sign out everywhere, including here. You can sign back in right away.</p>
        <form action={signOutEverywhere} className="mt-4">
          <Button type="submit" variant="outline" size="sm" className="border-danger/40 text-danger hover:bg-danger-soft">
            <LogOut /> Sign out everywhere
          </Button>
        </form>
      </section>
    </div>
  );
}
