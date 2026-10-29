"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";

import type { CodeFormState } from "../email-actions";

type Action = (state: CodeFormState, formData: FormData) => Promise<CodeFormState>;

/**
 * Enter-the-code form with a "send a new code" button. Both buttons submit
 * the same form and share one state, so the message shown is always the one
 * from the latest click (a stale resend error can't hide a verify error).
 */
export function CodeForm({
  verifyAction,
  resendAction,
  resendLabel = "Send a new code",
  callbackUrl,
}: {
  verifyAction: Action;
  resendAction: Action;
  resendLabel?: string;
  callbackUrl?: string;
}) {
  const [state, submit, pending] = useActionState<CodeFormState, FormData>(
    (previous, formData) => (formData.get("intent") === "resend" ? resendAction(previous, formData) : verifyAction(previous, formData)),
    {},
  );

  return (
    <form action={submit} className="space-y-4" noValidate>
      {callbackUrl && <input type="hidden" name="callbackUrl" value={callbackUrl} />}
      <label className="block text-sm">
        <span className="font-medium">6-digit code</span>
        <input
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 \-]*"
          maxLength={7}
          autoFocus
          aria-invalid={Boolean(state.error)}
          aria-describedby="code-message"
          className="mt-1 h-12 w-full rounded-xl border border-border bg-card px-3 text-center font-mono text-2xl tracking-[0.4em] aria-[invalid=true]:border-danger"
        />
      </label>
      <div id="code-message" aria-live="polite" className="min-h-5 text-sm">
        {state.error ? <p className="text-danger">{state.error}</p> : state.notice ? <p className="text-success">{state.notice}</p> : null}
      </div>
      <Button type="submit" name="intent" value="verify" size="lg" disabled={pending} className="w-full">
        {pending ? "Please wait…" : "Continue"}
      </Button>
      <button
        type="submit"
        name="intent"
        value="resend"
        disabled={pending}
        className="text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50"
      >
        {resendLabel}
      </button>
    </form>
  );
}
