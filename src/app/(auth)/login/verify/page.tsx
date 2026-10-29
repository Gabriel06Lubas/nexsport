import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { CodeForm } from "@/modules/auth/components/code-form";
import { resendSignInCode, verifySignInCode } from "@/modules/auth/email-actions";
import { pendingSignInEmail } from "@/modules/auth/email-code";
import { maskEmail } from "@/modules/auth/lib/email-code-policy";
import { safeCallbackUrl } from "@/modules/auth/lib/redirects";

export const metadata: Metadata = { title: "Enter your code", robots: { index: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function VerifySignInPage({ searchParams }: { searchParams: SearchParams }) {
  const email = await pendingSignInEmail();
  if (!email) redirect("/login");
  const raw = (await searchParams).callbackUrl;
  const callbackUrl = safeCallbackUrl(Array.isArray(raw) ? raw[0] : raw);

  return (
    <div className="w-full max-w-sm">
      <div className="rounded-3xl border border-border bg-card p-6 shadow-[0_24px_60px_-30px_rgb(11_18_32/0.35)] sm:p-8">
        <h1 className="text-2xl font-semibold tracking-tight">Check your email</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          We sent a 6-digit code to <span className="font-medium text-foreground">{maskEmail(email)}</span>. It expires in 10
          minutes.
        </p>
        <div className="mt-6">
          <CodeForm verifyAction={verifySignInCode} resendAction={resendSignInCode} callbackUrl={callbackUrl} />
        </div>
      </div>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        <Link href="/login" className="hover:text-foreground">
          ← Use a different email
        </Link>
      </p>
    </div>
  );
}
