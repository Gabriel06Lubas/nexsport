"use client";

import { Mail } from "lucide-react";
import { useActionState } from "react";

import { requestSignInCode, type CodeFormState } from "../email-actions";

export function EmailSignInForm({ callbackUrl }: { callbackUrl: string }) {
  const [state, action, pending] = useActionState<CodeFormState, FormData>(requestSignInCode, {});

  return (
    <form action={action} className="space-y-3" noValidate>
      <input type="hidden" name="callbackUrl" value={callbackUrl} />
      <label className="block text-sm">
        <span className="sr-only">Email address</span>
        <input
          type="email"
          name="email"
          defaultValue={state.email}
          placeholder="you@example.com"
          autoComplete="email"
          maxLength={254}
          required
          aria-invalid={Boolean(state.error)}
          aria-describedby="email-message"
          className="h-11 w-full rounded-full border border-border bg-card px-4 text-sm aria-[invalid=true]:border-danger"
        />
      </label>
      {state.error && (
        <p id="email-message" role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-ink text-sm font-medium text-ink-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        <Mail className="size-4" aria-hidden /> {pending ? "Sending code…" : "Continue with email"}
      </button>
    </form>
  );
}
