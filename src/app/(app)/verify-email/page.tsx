import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { CodeForm } from "@/modules/auth/components/code-form";
import { confirmEmailCode, sendVerifyEmailCode } from "@/modules/auth/email-actions";
import { requireSignedInUser } from "@/modules/auth/dal";
import { activeVerifyCodeFor } from "@/modules/auth/email-code";
import { maskEmail } from "@/modules/auth/lib/email-code-policy";

export const metadata: Metadata = { title: "Confirm your email" };

export default async function VerifyEmailPage() {
  const user = await requireSignedInUser();
  if (user.emailConfirmed) redirect("/dashboard");
  const pending = await activeVerifyCodeFor(user.id);

  return (
    <div className="mx-auto max-w-md">
      <p className="text-sm font-semibold uppercase tracking-wider text-accent-text">One more step</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Confirm your email</h1>
      <p className="mt-2 text-muted-foreground">
        {pending ? (
          <>
            We sent a 6-digit code to <span className="font-medium text-foreground">{maskEmail(user.email)}</span>. It expires in 10
            minutes.
          </>
        ) : (
          <>
            We’ll send a 6-digit code to <span className="font-medium text-foreground">{maskEmail(user.email)}</span>.
          </>
        )}
      </p>
      <div className="mt-8 rounded-3xl border border-border bg-card p-6 sm:p-8">
        <CodeForm
          verifyAction={confirmEmailCode}
          resendAction={sendVerifyEmailCode}
          resendLabel={pending ? "Send a new code" : "Send me a code"}
        />
      </div>
    </div>
  );
}
