import { CircleCheck, CircleX } from "lucide-react";

import { ConnectBadge, formatDate, Panel } from "@/components/dashboard/ui";
import { ActionButton, ActionForm, FormFooter, SelectField } from "@/components/forms/action-form";
import type { ActionState } from "@/lib/action-state";
import { formatMoney } from "@/lib/utils";

import type { ConnectAccountRow } from "../connect";
import { connectNextStep, DISCONNECTED } from "../lib/connect-status";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

// Stripe's requirement codes, in words. Anything else is shown as Stripe names it.
const requirementLabels: Record<string, string> = {
  external_account: "Bank account for payouts",
  "business_profile.url": "Business website",
  "business_profile.mcc": "Type of business",
  "business_profile.product_description": "What you sell",
  tos_acceptance: "Accept Stripe's terms",
  "tos_acceptance.date": "Accept Stripe's terms",
  "tos_acceptance.ip": "Accept Stripe's terms",
  "individual.verification.document": "Identity document",
  "individual.id_number": "ID number",
  "individual.dob.day": "Date of birth",
  "individual.address.line1": "Home address",
  "individual.phone": "Phone number",
  "company.tax_id": "Company tax ID",
  "company.address.line1": "Company address",
  representative: "Company representative",
};
const describe = (code: string) => requirementLabels[code] ?? code;

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      {ok ? <CircleCheck className="size-4 text-success" aria-hidden /> : <CircleX className="size-4 text-danger" aria-hidden />}
      <span>
        {label}: <span className="font-medium">{ok ? "yes" : "no"}</span>
      </span>
    </li>
  );
}

const notices: Record<string, { text: string; tone: "ok" | "info" | "error" }> = {
  return: { text: "Welcome back. Stripe saved your details; the status below is up to date.", tone: "ok" },
  error: { text: "Stripe couldn't start the setup just now. Try again in a moment.", tone: "error" },
};

/**
 * Stripe Connect status and the next step, for a club (Billing) or a coach
 * (Earnings). Shown to everyone who can see the page; the buttons only to
 * the account holder (`canManage`).
 */
export function ConnectPanel({
  account,
  canManage,
  enabled,
  hidden,
  start,
  dashboard,
  who,
  purpose,
  countries,
  waiting,
  notice,
  timeZone,
}: {
  account: ConnectAccountRow | null;
  canManage: boolean;
  /** Stripe is configured on this deployment. */
  enabled: boolean;
  hidden: Record<string, string>;
  start: Action;
  dashboard: Action;
  /** "Padel Central" / "you" */
  who: string;
  /** What connecting unlocks, in a sentence. */
  purpose: string;
  /** Country picker (coaches, before their account exists). */
  countries?: { value: string; label: string }[];
  /** Shares queued for this account until it can receive them. */
  waiting?: { n: number; amount: number; currency: string };
  notice?: string;
  timeZone: string;
}) {
  const step = connectNextStep(account);
  const shown = notice ? notices[notice] : undefined;
  const ready = account?.status === "ACTIVE";
  return (
    <Panel title="Stripe Connect account" action={<ConnectBadge status={account?.status ?? null} chargesEnabled={account?.chargesEnabled ?? null} payoutsEnabled={account?.payoutsEnabled ?? null} />}>
      <div className="space-y-4 p-5 text-sm">
        {shown && (
          <p role="status" className={shown.tone === "error" ? "rounded-xl bg-danger-soft px-4 py-3 text-danger" : "rounded-xl bg-muted px-4 py-3"}>
            {shown.text}
          </p>
        )}

        {!account ? (
          <>
            <p>No Stripe account is connected yet. {purpose}</p>
            <p className="text-muted-foreground">
              Connecting creates a Stripe account for {who}. Stripe asks for the business and bank details it needs to pay out, then nexport&apos;s fee is taken
              automatically and the rest is sent to you.
            </p>
          </>
        ) : (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="space-y-3">
              <ul className="space-y-2">
                <Check ok={account.chargesEnabled} label="Charges enabled" />
                <Check ok={account.payoutsEnabled} label="Payouts enabled" />
                <Check ok={account.detailsSubmitted} label="Details submitted" />
              </ul>
              <p className="text-xs text-muted-foreground">
                <span className="font-mono">{account.stripeAccountId}</span> · {account.country} · payouts in {account.defaultCurrency.toUpperCase()} · updated{" "}
                {formatDate(account.updatedAt, timeZone)}
              </p>
            </div>
            <div className="min-w-0 space-y-2">
              {ready && account.requirementsDue.length === 0 ? (
                <p className="text-success">All set. Stripe can take payments and pay out to your bank.</p>
              ) : account.status === "PENDING_VERIFICATION" ? (
                <p>Stripe is reviewing the details. This usually takes a few minutes, sometimes a day or two; nothing to do meanwhile.</p>
              ) : account.status === "REJECTED" ? (
                <p className="text-danger">Stripe declined this account. Contact Stripe support from the Stripe dashboard, or nexport support.</p>
              ) : account.disabledReason === DISCONNECTED ? (
                <p className="text-danger">This account was disconnected from nexport in Stripe, so it can&apos;t take payments here. Connect a new one to start again.</p>
              ) : !account.detailsSubmitted ? (
                <>
                  <p>Setup isn&apos;t finished. Continue in Stripe where you left off.</p>
                  {account.requirementsDue.length > 0 && (
                    <>
                      <p className="text-xs text-muted-foreground">Stripe still needs:</p>
                      <ul className="list-inside list-disc text-xs">
                        {[...new Set(account.requirementsDue.map(describe))].map((r) => (
                          <li key={r}>{r}</li>
                        ))}
                      </ul>
                    </>
                  )}
                </>
              ) : (
                <>
                  <p className="font-medium text-danger">Stripe needs more information</p>
                  {account.requirementsDue.length > 0 && (
                    <ul className="list-inside list-disc text-xs">
                      {[...new Set(account.requirementsDue.map(describe))].map((r) => (
                        <li key={r} className="break-all">
                          {r}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
              {waiting && waiting.n > 0 && (
                <p className="text-xs text-muted-foreground">
                  {formatMoney(waiting.amount, waiting.currency)} from {waiting.n} {waiting.n === 1 ? "payment is" : "payments are"} waiting and will be sent as soon as Stripe
                  enables transfers.
                </p>
              )}
            </div>
          </div>
        )}

        {!enabled ? (
          <p className="text-xs text-muted-foreground">Online payments aren&apos;t enabled on this deployment yet.</p>
        ) : !canManage ? (
          <p className="text-xs text-muted-foreground">Only the club owner can connect or change the club&apos;s Stripe account.</p>
        ) : step === "connect" && countries ? (
          <ActionForm action={start} hidden={hidden} label="Connect with Stripe" className="flex flex-wrap items-end gap-3">
            <SelectField name="country" label="Country you're based in" options={countries} defaultValue="ES" hint="Stripe can't change this later" />
            <FormFooter submit="Connect with Stripe" pendingLabel="Opening Stripe…" />
          </ActionForm>
        ) : step === "dashboard" ? (
          <ActionButton action={dashboard} hidden={hidden} pendingLabel="Opening Stripe…">
            Open Stripe dashboard
          </ActionButton>
        ) : (
          <ActionButton action={start} hidden={hidden} variant="primary" pendingLabel="Opening Stripe…">
            {step === "connect" ? (account ? "Connect a new Stripe account" : "Connect with Stripe") : step === "continue" ? "Continue setup in Stripe" : "Update details in Stripe"}
          </ActionButton>
        )}
      </div>
    </Panel>
  );
}
